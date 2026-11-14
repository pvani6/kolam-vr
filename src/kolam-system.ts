/**
 * Kolam — the game.
 *
 * DRAW (main game): only the dots are on the board; the kolam to make is on
 * an open kolam notebook on a stand beside you. Draw it freehand with a pinch. Correct parts glow
 * gold; stray strokes stay white and lower your accuracy.
 *
 * PUZZLE (bonus, key G): the woven kolam starts as several separate lines, each
 * in its own colour. Pinch a gap between two dots to make the line turn there
 * (cross → turn → other turn). Join everything into ONE line — the true
 * sikku kolam — in as few turns as possible.
 *
 * LEARN: trace kolams to learn how they are drawn.
 *
 * Draw real kolams with your fingertip. Pinch to draw; the kolam lights up
 * gold where you've traced it. Trace the whole kolam to finish the level.
 *
 * Modes:
 *  - Easy:   the kolam is shown faintly on the board — trace it.
 *  - Medium: it is shown for a few seconds, then draw it from memory
 *            (a small picture card stays beside the board).
 *  - Hard:   only the picture card — draw it like copying from a book.
 *
 * "Show me" plays a demo: a glowing pen draws the kolam on your board.
 *
 * Kolam rule: the line loops AROUND the dots. Touching a dot costs a star.
 *
 * Input:
 *  - Hands (main):   pinch thumb + index near the board, move the index tip.
 *                    Pinch on a button below the board to press it.
 *  - Controllers:    point and hold the trigger.
 *  - Desktop (2D):   click and drag.
 *  - Keyboard (testing): N next, P previous, R restart, 1/2/3 mode, D demo.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  createSystem,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { kolamAudio } from './kolam-audio.js';
import { FlourParticles } from './kolam-flour.js';
import { dotsFor, LEVELS } from './kolam-levels.js';
import { design, kolamCurves, type KolamDesign, type MirrorType, type P2 } from './kolam-patterns.js';
import { dailyLevel, margazhiDay, progress, STAGES, stageOf } from './kolam-progress.js';
import { saveSettings, settings } from './kolam-settings.js';
import { PUZZLES } from './kolam-puzzles.js';

type Hand = 'left' | 'right';

/** One pinch-to-release line. The "since…" fields are what was drawn after
 * the last correct point, so a mistake rubs out only that wrong bit. */
interface Stroke {
  inkStart: number;
  covered: number[];
  dots: number[];
  ink: number;
  stray: number;
  flour: number;
  run: number;
  alerted: boolean;
  goodInk: number;
  sinceInk: number;
  sinceStray: number;
  sinceFlour: number;
  sinceDots: number[];
  path: number; // length of flour drawn in this stroke, in coarse steps (board units)
  pathAnchor: P2 | null; // last point counted into path
  along: Set<number>; // the distinct bits of kolam line this stroke went along
  goAlong: number; // movement in the direction of the line you're on
  goAcross: number; // movement sideways across it
  pts: (P2 & { ink: number; flour: number; cov: number })[]; // the stroke's shape (a point every ~1/20 dot gap) and how much ink/flour/line was down then
  cutCovered?: number; // a dot was touched: on rub-out, keep only this much of `covered`
}
type Mode = 'easy' | 'medium' | 'hard';
type Zone = 'board' | 'buttons';
interface Hit extends P2 {
  zone: Zone;
}

// ---- Layout (metres) --------------------------------------------------------
const BOARD_SIZE = 0.42;
const HALF = BOARD_SIZE / 2;
const PATTERN_AREA = 0.34;
const MAX_SPACING = 0.075;
const BUTTON_H = 0.085; // big enough to read and hit on the ground
const BUTTONS_W = 0.66; // (old ground strip, unused)
// Buttons: an upright column standing to the right of the drawing patch,
// facing you — easy to point at or tap, never under your hands.
const COL_W = 0.15;
const COL_H = 0.56;
const BUTTON_GAP = 0.03;
const BUTTON_Y = -HALF - BUTTON_GAP - BUTTON_H / 2; // centre of the button strip
const CARD_SIZE = 0.15;
// The kolam notebook: an open book on a small wooden stand beside the board
const PAGE_W = 0.15;
const PAGE_H = 0.2;

// ---- Feel -------------------------------------------------------------------
const HAND_REACH = 0.12;
const PINCH_CLOSING = 0.006; // m: thumb and finger this much closer than usual = starting to pinch
const PINCH_SETTLE = 0.02; // m/s: how fast "usual" follows a hand that stays a little closed
const HOVER_REACH = 0.45; // m: a hand held flat this high over the ground still shows the ring under its fingertip
const TIP_STILL = 0.004; // metres: the fingertip moved less than this, so the fingers did not curl
// FoV-aware layout (Meta VR Glasses see only ~37° left/right, 25° up, 43°
// down). In XR everything is scaled to 80% and placed so the drawing patch,
// notebook, buttons and score all sit inside that view.
const XR_SCALE = 0.8;
// Meta VR Glasses only: warnings float in the upper part of your view (the
// layout itself is the same as on Quest 3).
const GLASSES_BANNER_UP = 14; // warnings sit this far above where you look
const GLASSES_BANNER_DIST = 0.6; // metres
const COLOR_CURSOR = 0xffb347; // the pointing ring (gold, unlike the white dots)
// "Almost there" hint (Draw mode)
const HINT_FROM_PROGRESS = 0.6; // share of the line drawn before hints can appear
const HINT_AFTER_IDLE = 4; // seconds without drawing
const HINT_SECONDS = 3.5; // how long the missing bits glow
const HINT_REPEAT = 8; // seconds before the hint can come again
// A stroke whose flour is this many times longer than its progress along the
// kolam line is a scribble (judged when you let go; a very long one sooner).
const SCRIBBLE_RATIO = 3;
const SCRIBBLE_MIN = 0.25; // dot gaps: strokes shorter than this are just dabs
// A finished stroke must match the kolam: at least this share of it close to a
// kolam line (within MATCH_NEAR dot gaps) and running its way (within ~35°),
// with direction measured over ±MATCH_SPAN dot gaps.
const MATCH_MIN = 0.85;
const MATCH_NEAR = 0.22;
const MATCH_COS = 0.82;
const MATCH_SPAN = 0.1;
// Mistakes are shown, not snatched away: the wrong part stays red this long
// before it is rubbed out, the message stays this long, and after the third
// mistake the kolam waits this long before starting again.
const MISTAKE_SHOW = 2;
const MISTAKE_BANNER = 3.5;
const RESET_PAUSE = 4.5;
const KEEP_MIN = 0.5; // dot gaps of new kolam line a stroke must have drawn for its good part to stay after a mistake
const SCRIBBLE_SIDEWAYS = 0.75; // moving across the line this much compared with along it
const SCRIBBLE_RATIO_LIVE = 4;
// Big kolams have small dot gaps; in VR the drawing ground grows (up to this
// much) so the gaps stay big enough for a real, slightly wobbly fingertip.
const XR_MIN_SPACING = 0.042; // metres between dots we aim for in VR
const XR_MAX_ZOOM = 1.25;
const BOARD_DISTANCE = 0.55;
const BOARD_DROP = 0.27; // low, like the ground, but inside the glasses' 43° downward view
// In the flat browser view the board sits lower and further away so the
// house behind it stays visible. (In VR it is at a comfortable arm's reach.)
const BOARD_DISTANCE_2D = 1.0;
const BOARD_DROP_2D = 0.35;
// A kolam is drawn on the ground. The drawing surface lies (almost) flat,
// tilted towards you by this many degrees so it is comfortable while seated.
const GROUND_TILT_XR = 30;
const GROUND_TILT_2D = 48; // the flat browser view needs more tilt to be readable
const MIN_STEP = 0.002;
const PINCH_GRACE = 0.25; // s: hand tracking briefly losing the pinch shouldn't break a stroke
const SMOOTHING = 0.38; // 0..1, higher = follows the finger more tightly
/**
 * How forgiving Draw mode is, in dot spacings. A real tracked hand wobbles a
 * few millimetres, so staying on your line is looser than first finding it.
 */
const JUDGE = {
  catchLine: 0.22, // how close to a line counts as being on it
  stayOnLine: 0.22, // once following a line, how far you may wobble off it
  offRun: 0.45, // how far off the kolam before the stroke is spoiled
  jumpRun: 0.3, // how far along another line before it counts as a jump
  strayRatio: 0.25, // share of a stroke that may be off the line
  dotHit: 0.14, // touching a dot = your line visibly touches it (dot radius + half your line), as in the first version
  dotPoints: 2, // two tracked points in a row (one 1/72 s tracking flicker is not a touch)
  outerLoop: 0.4, // outside the dots, how far from the outer loop still counts as on it
};
const MAX_INK_SEGMENTS = 8000;
const NEXT_LEVEL_DELAY = 4;
const MEDIUM_PREVIEW_SECONDS = 5;
const DEMO_SPEED = 0.09; // metres per second along the line
const DEMO_MIN_SECONDS = 4;
const DEMO_MAX_SECONDS = 30;

const MODE_SETTINGS: Record<Mode, { tolerance: number; completeAt: number }> = {
  // Tolerance is in dot spacings. Rings sit ~0.15 from the woven lines, so stay
  // below that or tracing a line would also fill in the ring beside it.
  easy: { tolerance: 0.13, completeAt: 0.95 },
  medium: { tolerance: 0.14, completeAt: 0.9 },
  hard: { tolerance: 0.17, completeAt: 0.9 }, // Draw mode (freehand, no guide)
};

// ---- Colours ----------------------------------------------------------------
const COLOR_BOARD = new Color(0x3a2a20); // swept, cow-dung-washed earth
const COLOR_GROUND_HC = new Color(0x000000); // high-contrast ground
const COLOR_DOT = 0xfff4dc;
const COLOR_DOT_BAD = 0xff4d4d;
const COLOR_GUIDE = new Color(0x7d6a58); // faint guide (Learn mode)
const DEMO_DIM = 0.2; // how faint your lines and the guide get while Show me draws
const COLOR_TRACED = new Color(0xf7f1e3); // rice-flour white
const INK_GOOD = new Color(0xffffff); // your line, on the kolam
const INK_BAD = new Color(0xff5a5a); // your line, off the kolam
const INK_GOOD_HC = new Color(0xffe14d); // high-contrast mode: bright yellow
const COLOR_DEMO = 0xffffff;
const COLOR_INK = 0xffffff;
/** One colour per separate line in the puzzle. */
const LINE_COLORS = [0xffd98a, 0xff7aa2, 0x7bd389, 0x5ec8f2, 0xb388ff, 0xffb347, 0xf25e5e, 0x9ad0ff, 0xe0e070, 0xff9de6].map(
  (c) => new Color(c),
);
const FESTIVE = [0xff5c8a, 0xffb347, 0xffe066, 0x7bd389, 0x5ec8f2, 0xb388ff].map((c) => new Color(c));

const BUTTONS = ['Levels', 'Today', 'Learn', 'Draw', 'Show me', 'Rub out', 'Restart', 'Next', 'Settings'] as const;
type ButtonName = (typeof BUTTONS)[number];

/** A ribbon (thick line) mesh in the board's XY plane. */
class Ribbon {
  readonly geometry = new BufferGeometry();
  readonly positions: Float32Array;
  readonly colors: Float32Array | null;
  vertexCount = 0;

  constructor(maxSegments: number, withColors: boolean) {
    this.positions = new Float32Array(maxSegments * 6 * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.colors = withColors ? new Float32Array(maxSegments * 6 * 3) : null;
    if (this.colors) this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
  }

  clear(): void {
    this.vertexCount = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** Add one segment a→b. A zero-length segment is invisible (used as a gap). */
  addSegment(a: P2, b: P2, width: number, z: number, color?: Color): void {
    if ((this.vertexCount + 6) * 3 > this.positions.length) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let quad: number[][];
    if (len < 1e-9) {
      quad = Array.from({ length: 6 }, () => [a.x, a.y]);
    } else {
      const ex = (dx / len) * width * 0.5;
      const ey = (dy / len) * width * 0.5;
      const nx = (-dy / len) * (width / 2);
      const ny = (dx / len) * (width / 2);
      const ax = a.x - ex;
      const ay = a.y - ey;
      const bx = b.x + ex;
      const by = b.y + ey;
      quad = [
        [ax + nx, ay + ny], [ax - nx, ay - ny], [bx + nx, by + ny],
        [ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny],
      ];
    }
    for (const [x, y] of quad) {
      const i = this.vertexCount * 3;
      this.positions[i] = x;
      this.positions[i + 1] = y;
      this.positions[i + 2] = z;
      if (this.colors && color) {
        this.colors[i] = color.r;
        this.colors[i + 1] = color.g;
        this.colors[i + 2] = color.b;
      }
      this.vertexCount++;
    }
    this.geometry.setDrawRange(0, this.vertexCount);
    (this.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    if (this.colors) (this.geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }

  setSegmentColor(i: number, c: Color): void {
    if (!this.colors) return;
    for (let v = 0; v < 6; v++) {
      const k = (i * 6 + v) * 3;
      this.colors[k] = c.r;
      this.colors[k + 1] = c.g;
      this.colors[k + 2] = c.b;
    }
    (this.geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }
}

/** A plane showing a 2D canvas (labels, buttons, picture card). */
class CanvasPlane {
  readonly canvas = document.createElement('canvas');
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;

  constructor(pxW: number, pxH: number, w: number, h: number) {
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
  }

  get ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext('2d')!;
  }

  refresh(): void {
    this.texture.needsUpdate = true;
  }
}

/** Convex hull of points, counter-clockwise (Andrew's monotone chain). */
function convexHull(pts: Vector2[]): Vector2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vector2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vector2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export class KolamSystem extends createSystem({}) {
  private board = new Group(); // the ground you draw on (lies flat)
  private hud = new Group(); // upright: title, pop-ups, notebook, score panel
  private levelGroup = new Group();

  // Level + mode
  private levelIndex = 0;
  private game: 'learn' | 'draw' | 'puzzle' = 'draw';
  private daily = false; // playing today's kolam
  private settingsOpen = false;
  private settingsPanel = new CanvasPlane(1024, 1024, BOARD_SIZE, BOARD_SIZE);
  private bgMat!: MeshBasicMaterial;
  // Draw-mode scoring
  private inkPoints = 0;
  private strayPoints = 0;
  private levelTime = 0;
  private timing = false;
  // Lifelines (Draw mode): 3 lamps. A real mistake costs one; lose all → restart.
  private lives = 3;
  // Every pinch is one stroke; lamps let you rub out a wrong stroke and redraw it
  private strokes: Stroke[] = [];
  private stroke: Stroke | null = null;
  private almostShown = false;
  private almostAt = 0;
  // Line-following: each closed line of the kolam is a loop of samples
  private loopStart: number[] = [];
  private loopLen: number[] = []; // without the repeated closing sample
  private loopOf: number[] = [];
  private perSpacing = 10; // samples per dot spacing along the line
  private track: { loop: number; k: number } | null = null; // where your finger is on the line
  private strokeStart: P2 | null = null;
  // Gaze: the last tracked eye ray, held briefly through tracking drop-outs
  private gazeOrigin = new Vector3();
  private gazeQuat = new Quaternion();
  private gazeAge = 99; // seconds since gaze was last tracked
  private usingGaze = false;
  private failTimer = 0;
  private pendingErase: { timer: number; whole: boolean } | null = null; // a mistake shown in red, rubbed out soon
  private flashMsg = '';
  private flashTimer = 0;
  // Big pop-up banner above the board, and the score panel to its right
  private banner = new CanvasPlane(1024, 300, 0.56, 0.164);
  private bannerSmall = false;
  private bannerTime = 0; // seconds the banner has been showing
  private bannerLife = 0; // total seconds to show it
  private status = new CanvasPlane(480, 640, 0.15, 0.2);
  private bannerRoot = new Group(); // follows your gaze down to the ground
  private groundStatus = new CanvasPlane(1024, 112, BOARD_SIZE, BOARD_SIZE * (112 / 1024));
  private rimMat!: MeshStandardMaterial;
  private rimFlash = 0;
  // Rice flour, hand-tracking safety, and the guided first kolam
  private flour = new FlourParticles();
  private tipHeight = 0.05; // fingertip height above the ground (for the flour)
  private releaseTimer = 0; // pinch drop-outs shorter than PINCH_GRACE are ignored
  private smooth: P2 | null = null; // smoothed fingertip position while drawing
  private tutorial = false;
  private tutorialStep = 0;
  private statusKey = '';
  // Levels screen
  private selecting = false;
  private selectStage = 0;
  private selector = new CanvasPlane(1024, 1024, BOARD_SIZE, BOARD_SIZE);
  // Puzzle state
  private puzzleIndex = 0;
  private mirrors = new Map<string, MirrorType>(); // gap key "X,Y" (doubled) → turn
  private moves = 0;
  private hints = 0;
  private lineCount = 0;
  private gaps: { key: string; p: P2 }[] = []; // interior gaps, in board coords
  private mode: Mode = 'hard'; // Draw mode is the default game
  private spacing = 0.05;
  private dotCenters: Vector2[] = [];
  private dotMaterials: MeshBasicMaterial[] = [];
  private dotTouched: boolean[] = [];
  private mistakes = 0;

  // The kolam: dense samples; segment i joins sample i → i+1
  private samples: P2[] = [];
  private isGap: boolean[] = []; // segment i is a jump between separate lines
  private covered: boolean[] = [];
  private coveredCount = 0;
  private countable = 0; // samples that count towards progress
  private guide: Ribbon | null = null;
  private guideVisible = true;
  private previewTimer = 0;
  private tolerance = 0.01;
  private complete = false;
  private completeTimer = 0;
  private festivePhase = 0;

  // Demo ("Show me")
  private demo: Ribbon | null = null;
  private hint: Ribbon | null = null;
  private hintMat: MeshBasicMaterial | null = null;
  private hintTime = 0;
  private hintCooldown = 0;
  private idleTime = 0;
  private demoMat: MeshBasicMaterial | null = null;
  private demoHead!: Mesh;
  private demoActive = false;
  private demoWaiting = false; // Show me: waiting for your eyes to reach the ground
  private demoWait = 0;
  private demoLooking = 0;
  private demoT = 0; // seconds into the demo
  private demoDuration = 0;
  private demoFade = 0;
  private demoDrawn = 0; // segments added so far
  private demoCumLen: number[] = [];

  // Player's ink
  private ink = new Ribbon(MAX_INK_SEGMENTS, true);
  private inkMat: MeshBasicMaterial | null = null;
  private guideMat: MeshBasicMaterial | null = null;
  private demoDim = 1; // 1 = your lines and the guide at full strength; fades while Show me draws
  private inkWidth = 0.003;
  private lastPoint: P2 | null = null;

  // UI
  private label = new CanvasPlane(1024, 160, BOARD_SIZE, BOARD_SIZE * (160 / 1024));
  private buttons = new CanvasPlane(400, 1494, COL_W, COL_H);
  private btnRoot = new Group();
  private hoverButton = -1;
  private card = new CanvasPlane(600, 800, PAGE_W, PAGE_H); // right page: the kolam
  private leftPage = new CanvasPlane(600, 800, PAGE_W, PAGE_H); // left page: name + dot grid
  private book = new Group();
  private pressedButton = -1;
  private pressFlash = 0;
  private cursor!: Mesh; // right hand (and the mouse)
  private cursorLeft!: Mesh; // left hand: each hand shows where IT will draw
  private cursorMat!: MeshBasicMaterial;
  private drawnThisFrame = 0; // metres drawn this frame (drives the flour sound)

  // Input state
  private drawingWith: Hand | 'mouse' | null = null;
  private needsPlacement = true;
  private labelDirty = true;
  private dotHull: Vector2[] = []; // outline of the dots (counter-clockwise)
  private strokeStartedOff = false; // the pinch began away from every kolam line
  private tipHistory: Record<Hand, { t: number; v: Vector3; mode: 'touch' | 'ray' }[]> = { left: [], right: [] };
  private openTip: Record<Hand, Vector3 | null> = { left: null, right: null };
  private lastGap: Record<Hand, number | null> = { left: null, right: null };
  private narrowView = false; // Meta VR Glasses (74° wide view) — set when VR starts
  private narrowChecked = false;
  private gapRef: Record<Hand, number | null> = { left: null, right: null }; // how far apart thumb and finger normally are
  private gapTime: Record<Hand, number> = { left: 0, right: 0 };
  private tipHeld: Record<Hand, { v: Vector3; mode: 'touch' | 'ray' } | null> = { left: null, right: null };
  private touchHit: Record<Hand, boolean> = { left: false, right: false };
  private strokeByTouch = false;
  private statusAt = 0;
  private statusLives = -1;
  private labelWait = 0;
  private dotOver = -1; // the dot the finger is over right now
  private dotOverCount = 0;
  private anchor: { eye: Vector3; forward: Vector3; distance: number; drop: number; tiltDeg: number; scale: number } | null = null;
  private placementDelay = 0;
  private mouseDown = false;
  private mousePressed = false;
  private mouseNdc = new Vector2(-10, -10);
  private raycaster = new Raycaster();
  private tmpV = new Vector3();
  private tmpDir = new Vector3();
  private tmpQ = new Quaternion();

  init(): void {
    this.buildBoard();
    this.world.createTransformEntity(this.board, { persistent: true });
    this.world.createTransformEntity(this.hud, { persistent: true });
    this.world.createTransformEntity(this.bannerRoot, { persistent: true });
    this.world.createTransformEntity(this.btnRoot, { persistent: true });
    this.loadLevel(this.game === 'draw' ? progress.current : 0); // continue where you stopped
    // Automated play-testing hook (only with ?kolamtest in the URL)
    if (typeof location !== 'undefined' && location.search.includes('kolamtest')) Object.assign(window as unknown as Record<string, unknown>, { __kolam: this, __kolamJudge: JUDGE });

    this.cleanupFuncs.push(
      this.visibilityState.subscribe(() => {
        this.needsPlacement = true;
        this.placementDelay = 0.4;
        this.endStroke();
      }),
    );
    this.setupMouseAndKeys();
    kolamAudio.setMuted(!settings.sound);
  }

  // ===========================================================================
  // Building
  // ===========================================================================
  private buildBoard(): void {
    this.board.name = 'KolamBoard';

    // The ground patch, with a slightly lighter rim like freshly swept earth
    this.rimMat = new MeshStandardMaterial({ color: 0x5a4636, roughness: 1, side: DoubleSide });
    const rim = new Mesh(new PlaneGeometry(BOARD_SIZE + 0.05, BOARD_SIZE + 0.05), this.rimMat);
    rim.position.z = -0.003;
    this.board.add(rim);
    this.bgMat = new MeshBasicMaterial({ color: COLOR_BOARD, side: DoubleSide });
    const bg = new Mesh(new PlaneGeometry(BOARD_SIZE, BOARD_SIZE), this.bgMat);
    bg.position.z = -0.002;
    this.board.add(bg);

    // Title floats upright behind the ground patch
    this.label.mesh.position.set(0, 0.05, 0);
    this.hud.add(this.label.mesh);

    (this.buttons.mesh.material as MeshBasicMaterial).toneMapped = false;
    this.btnRoot.add(this.buttons.mesh);

    this.buildBook();

    this.board.add(this.levelGroup);

    // Levels screen, drawn over the board when open
    const sm = this.selector.mesh.material as MeshBasicMaterial;
    sm.toneMapped = false;
    this.selector.mesh.position.z = 0.006;
    this.selector.mesh.renderOrder = 9;
    this.selector.mesh.visible = false;
    this.board.add(this.selector.mesh);
    const spm = this.settingsPanel.mesh.material as MeshBasicMaterial;
    spm.toneMapped = false;
    this.settingsPanel.mesh.position.z = 0.007;
    this.settingsPanel.mesh.renderOrder = 10;
    this.settingsPanel.mesh.visible = false;
    this.board.add(this.settingsPanel.mesh);

    // Pop-up banner: floats above the title, a little towards the player
    const bm = this.banner.mesh.material as MeshBasicMaterial;
    bm.toneMapped = false;
    bm.depthTest = false;
    this.banner.mesh.renderOrder = 20;
    this.banner.mesh.visible = false;
    this.banner.mesh.scale.set(0.55, 0.55, 1);
    this.bannerRoot.add(this.banner.mesh);

    // Lamps + time + accuracy, lying on the ground at the far edge of the patch
    const gm = this.groundStatus.mesh.material as MeshBasicMaterial;
    gm.toneMapped = false;
    this.groundStatus.mesh.position.set(0, HALF + 0.045, 0.002);
    this.board.add(this.groundStatus.mesh);
    this.board.add(this.flour.points);

    // Score panel: to the right of the board, turned towards the player
    const stm = this.status.mesh.material as MeshBasicMaterial;
    stm.toneMapped = false;
    this.status.mesh.position.set(HALF + 0.24, 0.12, -0.02); // up and right, clear of the button column, inside a narrow view
    this.status.mesh.rotation.set(-0.1, -0.5, 0);
    this.hud.add(this.status.mesh);

    this.inkMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false }); // crisp, full-bright line
    const inkMesh = new Mesh(this.ink.geometry, this.inkMat);
    inkMesh.frustumCulled = false;
    inkMesh.renderOrder = 3;
    this.board.add(inkMesh);

    this.demoHead = new Mesh(
      new CircleGeometry(0.007, 24),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
    );
    this.demoHead.renderOrder = 6;
    this.demoHead.visible = false;
    this.board.add(this.demoHead);

    // Where your hand points: a gold ring with a tiny centre — it must never
    // look like one of the kolam's white dots.
    // Drawn over everything (even your own hand, which curls over it as you pinch, and your line)
    this.cursorMat = new MeshBasicMaterial({ color: COLOR_CURSOR, transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false, depthTest: false, toneMapped: false });
    this.cursor = new Mesh(new RingGeometry(0.0065, 0.0095, 32), this.cursorMat);
    this.cursor.add(new Mesh(new CircleGeometry(0.0016, 12), this.cursorMat));
    this.cursor.renderOrder = 30;
    this.cursor.children[0].renderOrder = 30;
    this.cursor.visible = false;
    this.board.add(this.cursor);
    this.cursorLeft = this.cursor.clone(); // shares the gold material
    this.cursorLeft.visible = false;
    this.board.add(this.cursorLeft);
  }

  /**
   * An open kolam notebook on a small wooden book stand, to the left of the
   * board and turned towards the player — like learning from a family kolam
   * book on the doorstep.
   */
  private buildBook(): void {
    const wood = new MeshBasicMaterial({ color: 0x6b3a22 });
    const coverMat = new MeshBasicMaterial({ color: 0x7a1f2b }); // maroon cloth cover
    const pageEdge = new MeshBasicMaterial({ color: 0xe9dfc8 });
    const spineAngle = 0.12; // pages open in a gentle V

    // Book stand: a sloped board with a lip, on a short post
    const rest = new Mesh(new BoxGeometry(PAGE_W * 2 + 0.03, PAGE_H + 0.02, 0.008), wood);
    rest.position.z = -0.016;
    // (stand back face sits well behind the cover)
    this.book.add(rest);
    const lip = new Mesh(new BoxGeometry(PAGE_W * 2 + 0.03, 0.012, 0.02), wood);
    lip.position.set(0, -PAGE_H / 2 - 0.008, 0.002);
    this.book.add(lip);

    // Cover and the two pages (each page a canvas)
    for (const side of [-1, 1]) {
      const half = new Group();
      const cover = new Mesh(new BoxGeometry(PAGE_W + 0.006, PAGE_H + 0.008, 0.003), coverMat);
      cover.position.set((side * (PAGE_W + 0.006)) / 2, 0, -0.0085);
      half.add(cover);
      const stack = new Mesh(new BoxGeometry(PAGE_W, PAGE_H, 0.004), pageEdge);
      stack.position.set((side * PAGE_W) / 2, 0, -0.004);
      half.add(stack);
      const page = side < 0 ? this.leftPage.mesh : this.card.mesh;
      const pm = page.material as MeshBasicMaterial;
      pm.toneMapped = false;
      pm.transparent = false;
      pm.depthWrite = true; // otherwise the page block behind draws over it
      pm.polygonOffset = true; // and always win the depth test against it
      pm.polygonOffsetFactor = -4;
      pm.polygonOffsetUnits = -4;
      pm.needsUpdate = true;
      page.renderOrder = 2;
      page.position.set((side * PAGE_W) / 2, 0, 0.004);
      half.add(page);
      half.rotation.y = -side * spineAngle; // outer edges come towards the reader
      this.book.add(half);
    }

    // Place it to the left of the board, tilted back, turned to face the player
    this.book.position.set(-HALF - PAGE_W + 0.02, -0.12, 0.12);
    this.book.rotation.set(-0.2, 0.5, 0);
    this.hud.add(this.book);
  }

  /** Index of the current level/puzzle in the active game mode. */
  private currentIndex(): number {
    return this.game === 'puzzle' ? this.puzzleIndex : this.levelIndex;
  }

  private loadLevel(index: number): void {
    if (this.game === 'puzzle') {
      this.puzzleIndex = ((index % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
      this.mirrors.clear();
      this.moves = 0;
      this.hints = 0;
      this.complete = false;
      this.buildPuzzle();
      return;
    }
    let li = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    if (this.game === 'draw' && !this.daily && !progress.isUnlocked(li)) li = progress.unlocked;
    this.levelIndex = li;
    if (this.game === 'draw' && !this.daily) progress.setCurrent(li);
    this.closeSelector(false);
    const level = LEVELS[this.levelIndex];

    this.levelGroup.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
    });
    this.levelGroup.clear();
    this.ink.clear();
    this.endStroke();
    this.stopDemo();
    this.complete = false;
    this.mistakes = 0;
    this.inkPoints = 0;
    this.strayPoints = 0;
    this.levelTime = 0;
    this.timing = false;
    this.lives = 3;
    this.strokes = [];
    this.stroke = null;
    this.almostShown = false;
    this.failTimer = 0;
    this.pendingErase = null;
    this.flashMsg = '';
    this.flashTimer = 0;

    // Fit the design onto the board
    const xs = level.dots.map((d) => d.x);
    const ys = level.dots.map((d) => d.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1;
    this.spacing = Math.min(MAX_SPACING, PATTERN_AREA / extent);
    this.layoutBoard(); // bigger kolams get a bigger ground in VR
    const s = this.spacing;
    const toBoard = (p: P2): P2 => ({ x: (p.x - cx) * s, y: (p.y - cy) * s });

    const lineWidth = Math.max(0.0035, s * 0.09) * (settings.bigLines ? 1.5 : 1);
    this.inkWidth = lineWidth * 1.1; // your line is the kolam line in Draw mode
    this.tolerance = Math.max(0.006, s * MODE_SETTINGS[this.mode].tolerance);

    // All lines of the kolam, as one sample list with gaps between lines
    const curves = kolamCurves(level).map((c) => c.map(toBoard));
    this.samples = [];
    this.isGap = [];
    curves.forEach((curve, ci) => {
      const closed = [...curve, curve[0]];
      closed.forEach((p, i) => {
        if (this.samples.length > 0) this.isGap.push(i === 0 && ci > 0);
        this.samples.push(p);
      });
    });
    this.covered = new Array(this.samples.length).fill(false);
    this.coveredCount = 0;
    this.countable = this.samples.length;
    this.buildLoops();

    // Guide ribbon (the kolam to trace)
    this.guide = new Ribbon(this.samples.length + 4, true);
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.isGap[i] ? a : this.samples[i + 1];
      this.guide.addSegment(a, b, lineWidth, 0.001, COLOR_GUIDE);
    }
    this.guideMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    const guideMesh = new Mesh(this.guide.geometry, this.guideMat);
    guideMesh.frustumCulled = false;
    guideMesh.renderOrder = 1;
    this.levelGroup.add(guideMesh);

    // "Almost there" hint: the parts of the line you haven't drawn yet glow
    this.hint = new Ribbon(this.samples.length + 4, false);
    this.hintMat = new MeshBasicMaterial({ color: COLOR_CURSOR, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
    const hintMesh = new Mesh(this.hint.geometry, this.hintMat);
    hintMesh.frustumCulled = false;
    hintMesh.renderOrder = 4;
    this.levelGroup.add(hintMesh);
    this.hintTime = 0;
    this.idleTime = 0;
    this.hintCooldown = 0;

    // Demo ribbon (filled in progressively by "Show me")
    this.demo = new Ribbon(this.samples.length + 4, false);
    this.demoMat = new MeshBasicMaterial({ color: COLOR_DEMO, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false });
    const demoMesh = new Mesh(this.demo.geometry, this.demoMat);
    demoMesh.frustumCulled = false;
    demoMesh.renderOrder = 5;
    this.levelGroup.add(demoMesh);
    this.demoCumLen = [0];
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      const step = this.isGap[i] ? 0.03 : Math.hypot(b.x - a.x, b.y - a.y); // a short pause between lines
      this.demoCumLen.push(this.demoCumLen[i] + step);
    }

    // Dots
    this.dotCenters = [];
    this.dotMaterials = [];
    this.dotTouched = [];
    const dotR = Math.max(0.0035, s * 0.085) * (settings.bigLines || settings.highContrast ? 1.35 : 1);
    for (const d of level.dots) {
      const p = toBoard(d);
      const mat = new MeshBasicMaterial({ color: COLOR_DOT });
      const dot = new Mesh(new CircleGeometry(dotR, 20), mat);
      dot.position.set(p.x, p.y, 0.002);
      dot.renderOrder = 2;
      this.levelGroup.add(dot);
      const glow = new Mesh(
        new CircleGeometry(dotR * 2.2, 20),
        new MeshBasicMaterial({ color: COLOR_DOT, transparent: true, opacity: 0.15, blending: AdditiveBlending, depthWrite: false }),
      );
      glow.position.set(p.x, p.y, 0.0015);
      this.levelGroup.add(glow);
      this.dotCenters.push(new Vector2(p.x, p.y));
      this.dotMaterials.push(mat);
      this.dotTouched.push(false);
    }
    this.dotHull = convexHull(this.dotCenters);

    // Mode-specific visibility
    this.previewTimer = this.mode === 'medium' ? MEDIUM_PREVIEW_SECONDS : 0;
    this.setGuideVisible(this.mode !== 'hard');
    this.book.visible = this.mode !== 'easy';

    this.drawCard(level, curves, level.dots.map(toBoard));
    this.drawLabel();
    this.drawButtons();
    this.flour.clear();
    this.bgMat.color.copy(this.groundColor());
    this.tutorial = this.game === 'draw' && !this.daily && this.levelIndex === 0 && progress.stars(0) === 0;
    this.tutorialStep = this.tutorial ? 1 : 0;
    if (this.tutorial) {
      // First kolam ever: show the line to follow, and guide the first minute
      this.setGuideVisible(true);
      this.showBanner('Welcome to your doorstep', 'Pinch thumb and finger together, like holding rice flour', '#ffe2a0', 5);
    } else if (this.daily) {
      const day = new Date().toLocaleDateString('en-IN', { weekday: 'long' });
      const mz = margazhiDay();
      this.showBanner(
        mz ? `Margazhi day ${mz}` : "Today's kolam",
        `${day} · ${STAGES[stageOf(this.levelIndex)].name} · ${level.label}`,
        '#ffd98a',
        2.4,
      );
    } else if (this.game === 'draw') {
      this.showBanner(`Level ${this.levelIndex + 1} · ${level.name}`, `${STAGES[stageOf(this.levelIndex)].name} · ${level.label}`, '#ffe2a0', 1.6);
    }
  }

  // ===========================================================================
  // One-line puzzle
  // ===========================================================================
  private clearLevelGroup(): void {
    this.levelGroup.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
    });
    this.levelGroup.clear();
  }

  /** (Re)build the puzzle board from the current turns. */
  private buildPuzzle(): void {
    const pz = PUZZLES[this.puzzleIndex];
    const dots = dotsFor(pz.layout);
    const d = design('puzzle', pz.family, dots, this.mirrors);

    this.clearLevelGroup();
    this.ink.clear();
    this.endStroke();
    this.stopDemo();
    this.book.visible = false;
    this.mistakes = 0;

    const xs = dots.map((p) => p.x);
    const ys = dots.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1;
    this.spacing = Math.min(MAX_SPACING, PATTERN_AREA / extent);
    this.layoutBoard(); // bigger kolams get a bigger ground in VR
    const s = this.spacing;
    const toBoard = (p: P2): P2 => ({ x: (p.x - cx) * s, y: (p.y - cy) * s });
    const lineWidth = Math.max(0.004, s * 0.1);

    // Lines, each in its own colour
    const curves = kolamCurves(d).map((c) => c.map(toBoard));
    this.lineCount = curves.length;
    this.samples = [];
    this.isGap = [];
    const segColors: Color[] = [];
    curves.forEach((curve, ci) => {
      const closed = [...curve, curve[0]];
      closed.forEach((p, i) => {
        if (this.samples.length > 0) {
          this.isGap.push(i === 0 && ci > 0);
          segColors.push(LINE_COLORS[ci % LINE_COLORS.length]);
        }
        this.samples.push(p);
      });
    });
    this.covered = new Array(this.samples.length).fill(true);
    this.coveredCount = this.samples.length;
    this.countable = this.samples.length;
    this.guide = new Ribbon(this.samples.length + 4, true);
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      this.guide.addSegment(a, this.isGap[i] ? a : this.samples[i + 1], lineWidth, 0.001, segColors[i]);
    }
    this.guideMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    const guideMesh = new Mesh(this.guide.geometry, this.guideMat);
    guideMesh.frustumCulled = false;
    guideMesh.renderOrder = 1;
    this.levelGroup.add(guideMesh);

    // Gap markers: where you can pinch to make the line turn
    const has = new Set(dots.map((p) => `${p.x},${p.y}`));
    this.gaps = [];
    for (const p of dots) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!has.has(`${p.x + dx},${p.y + dy}`)) continue;
        const mx = p.x + dx / 2;
        const my = p.y + dy / 2;
        const key = `${Math.round(mx * 2)},${Math.round(my * 2)}`;
        const bp = toBoard({ x: mx, y: my });
        this.gaps.push({ key, p: bp });
        const turned = this.mirrors.has(key);
        const marker = new Mesh(
          new CircleGeometry(turned ? s * 0.07 : s * 0.045, 16),
          new MeshBasicMaterial({ color: turned ? 0xffffff : 0xc9a28c, transparent: true, opacity: turned ? 0.9 : 0.35, depthWrite: false }),
        );
        marker.position.set(bp.x, bp.y, 0.0025);
        marker.renderOrder = 3;
        this.levelGroup.add(marker);
      }
    }

    // Dots
    this.dotCenters = [];
    this.dotMaterials = [];
    this.dotTouched = [];
    const dotR = Math.max(0.0035, s * 0.085);
    for (const p0 of dots) {
      const p = toBoard(p0);
      const mat = new MeshBasicMaterial({ color: COLOR_DOT });
      const dot = new Mesh(new CircleGeometry(dotR, 20), mat);
      dot.position.set(p.x, p.y, 0.002);
      dot.renderOrder = 2;
      this.levelGroup.add(dot);
      this.dotCenters.push(new Vector2(p.x, p.y));
      this.dotMaterials.push(mat);
      this.dotTouched.push(false);
    }

    this.drawLabel();
    this.drawButtons();
    if (this.lineCount === 1 && this.moves > 0 && !this.complete) this.finishLevel();
  }

  /** Pinch on the board in puzzle mode: cycle the turn at the nearest gap. */
  private puzzleTap(hit: P2): void {
    if (this.complete) return;
    let best: { key: string; p: P2 } | null = null;
    let bestD = this.spacing * 0.38;
    for (const g of this.gaps) {
      const dd = Math.hypot(g.p.x - hit.x, g.p.y - hit.y);
      if (dd < bestD) {
        bestD = dd;
        best = g;
      }
    }
    if (!best) return;
    const cur = this.mirrors.get(best.key);
    if (!cur) this.mirrors.set(best.key, 'wall');
    else if (cur === 'wall') this.mirrors.set(best.key, 'bridge');
    else this.mirrors.delete(best.key);
    this.moves++;
    kolamAudio.tap();
    this.buildPuzzle();
  }

  /** Hint: undo one wrong turn, or else add one turn from a known solution. */
  private puzzleHint(): void {
    if (this.complete) return;
    const sol = new Map(PUZZLES[this.puzzleIndex].solution);
    for (const [k, t] of this.mirrors) {
      if (sol.get(k) !== t) {
        this.mirrors.delete(k);
        this.hints++;
        this.moves++;
        this.buildPuzzle();
        return;
      }
    }
    for (const [k, t] of sol) {
      if (!this.mirrors.has(k)) {
        this.mirrors.set(k, t);
        this.hints++;
        this.moves++;
        this.buildPuzzle();
        return;
      }
    }
  }

  private setGame(game: 'learn' | 'draw' | 'puzzle'): void {
    this.game = game;
    if (game === 'learn') this.mode = 'easy';
    if (game === 'draw') this.mode = 'hard';
    this.loadLevel(this.currentIndex());
  }

  /** The ground's colour — also used to hide the kolam in Draw mode. */
  private groundColor(): Color {
    return settings.highContrast ? COLOR_GROUND_HC : COLOR_BOARD;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.loadLevel(this.currentIndex());
  }

  /** Show or hide the untraced parts of the kolam. */
  private setGuideVisible(visible: boolean): void {
    this.guideVisible = visible;
    if (!this.guide) return;
    for (let i = 0; i < this.samples.length - 1; i++) {
      if (this.covered[i] && this.covered[i + 1]) continue;
      this.guide.setSegmentColor(i, visible ? COLOR_GUIDE : this.groundColor());
    }
  }

  // ===========================================================================
  // Frame loop
  // ===========================================================================
  update(delta: number): void {
    const inXR = this.visibilityState.value !== VisibilityState.NonImmersive;

    if (this.needsPlacement) {
      this.placementDelay -= delta;
      if (this.placementDelay <= 0) {
        const lift = settings.height * 0.05;
        if (inXR) this.placeBoard(this.player.head, BOARD_DISTANCE, BOARD_DROP - lift, GROUND_TILT_XR, XR_SCALE);
        else this.placeBoard(this.camera, BOARD_DISTANCE_2D, BOARD_DROP_2D - lift, GROUND_TILT_2D, 1);
        this.needsPlacement = false;
      }
    }

    if (this.previewTimer > 0 && !this.demoActive) {
      this.previewTimer -= delta;
      if (this.previewTimer <= 0) this.setGuideVisible(false);
      this.drawLabel();
    }

    if (this.pressFlash > 0) {
      this.pressFlash -= delta;
      if (this.pressFlash <= 0) {
        this.pressedButton = -1;
        this.drawButtons();
      }
    }

    this.labelWait -= delta;
    if (this.labelDirty && this.labelWait <= 0) {
      this.labelDirty = false;
      this.labelWait = 0.12;
      this.renderLabel();
    }

    this.updateDemo(delta);
    this.updateHint(delta);
    this.updateBanner(delta);
    this.updateDemoDim(delta);
    this.updateGlassesView(inXR);
    this.drawStatus();
    this.flour.update(delta);
    if (this.rimMat) {
      this.rimFlash = Math.max(0, this.rimFlash - delta * 1.2);
      this.rimMat.color.setHex(0x5a4636).lerp(new Color(0xff3b3b), this.rimFlash);
      this.rimMat.emissive.setHex(0xff2020).multiplyScalar(this.rimFlash * 0.6);
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) {
        this.flashMsg = '';
        this.drawLabel();
      }
    }
    if (this.pendingErase && this.failTimer <= 0) {
      this.pendingErase.timer -= delta;
      if (this.pendingErase.timer <= 0) this.finishPendingErase();
    }
    if (this.failTimer > 0) {
      this.failTimer -= delta;
      if (this.failTimer <= 0) this.loadLevel(this.currentIndex());
    }
    if (this.timing && !this.complete && this.failTimer <= 0 && this.visibilityState.value !== VisibilityState.VisibleBlurred && this.visibilityState.value !== VisibilityState.Hidden) {
      const before = Math.floor(this.levelTime);
      this.levelTime += delta;
      if (Math.floor(this.levelTime) !== before && this.game === 'draw') this.drawLabel();
    }
    kolamAudio.update(delta, delta > 0 ? this.drawnThisFrame / delta : 0);
    this.drawnThisFrame = 0;

    if (this.complete) {
      this.animateFestive(delta);
      this.completeTimer -= delta;
      if (this.completeTimer <= 0) {
        if (this.daily) {
          this.daily = false; // back to where you were in the levels
          this.loadLevel(progress.current);
        } else this.loadLevel(this.currentIndex() + 1);
      }
    }

    if (!inXR) {
      this.cursorLeft.visible = false;
      this.updateMouse();
      return;
    }

    this.updateGaze(delta);
    const ringShown: Record<Hand, boolean> = { left: false, right: false };
    let hover = -1;
    for (const hand of ['right', 'left'] as Hand[]) {
      const select = this.input.xr.getSelectState(hand);
      if (this.drawingWith === null) {
        const b = this.handButton(hand);
        if (b >= 0) {
          if (hover < 0) hover = b;
          if (select.start) this.clickButton(b);
          continue; // pointing at the buttons, not the ground
        }
      }
      const hit = this.getBoardHit(hand);
      // Each hand has its own ring (in the emulator the left mouse button
      // pinches the LEFT hand); while drawing, only the drawing hand's shows.
      if (hit && (this.drawingWith === null || this.drawingWith === hand)) {
        this.showCursor(hit, select.active, hand === 'left' ? this.cursorLeft : this.cursor);
        ringShown[hand] = true;
      }
      if (this.drawingWith === null && select.start && hit) {
        this.smooth = hit.zone === 'board' ? { x: hit.x, y: hit.y } : null;
        this.releaseTimer = 0;
        this.press(hand, hit);
      } else if (this.drawingWith === hand) {
        if (!select.active) {
          // Ignore a split-second loss of the pinch (hand-tracking dropout)
          this.releaseTimer += delta;
          if (this.releaseTimer > PINCH_GRACE) this.endStroke(true);
        } else {
          this.releaseTimer = 0;
          if (hit && hit.zone === 'board') {
            // Smooth the fingertip's natural shake
            if (!this.smooth) this.smooth = { x: hit.x, y: hit.y };
            const k = SMOOTHING;
            this.smooth.x += (hit.x - this.smooth.x) * k;
            this.smooth.y += (hit.y - this.smooth.y) * k;
            this.addPoint({ x: this.smooth.x, y: this.smooth.y });
          }
        }
      }
    }
    if (!ringShown.right) this.cursor.visible = false;
    if (!ringShown.left) this.cursorLeft.visible = false;
    this.setHover(hover);
  }

  /** A pinch/click landed on the board or a button. */
  private press(who: Hand | 'mouse', hit: Hit): void {
    kolamAudio.unlock(); // browsers only allow sound after a user action
    if (this.settingsOpen && hit.zone === 'board') {
      this.settingsTap(hit);
      return;
    }
    if (this.selecting && hit.zone === 'board') {
      this.selectorTap(hit);
      return;
    }
    if (hit.zone === 'buttons') {
      kolamAudio.tap();
      const i = Math.floor(((hit.x + BUTTONS_W / 2) / BUTTONS_W) * BUTTONS.length);
      if (i >= 0 && i < BUTTONS.length) this.onButton(BUTTONS[i], i);
      return;
    }
    if (this.game === 'puzzle') {
      this.puzzleTap(hit);
      return;
    }
    this.beginStroke(who, hit);
  }

  private onButton(name: ButtonName, index: number): void {
    this.pressedButton = index;
    this.pressFlash = 0.25;
    if (name !== 'Settings' && this.settingsOpen) this.closeSettings();
    if (!['Show me', 'Rub out', 'Restart', 'Settings', 'Today'].includes(name)) this.daily = false;
    switch (name) {
      case 'Today':
        this.startDaily();
        break;
      case 'Settings':
        if (this.settingsOpen) this.closeSettings();
        else this.openSettings();
        break;
      case 'Levels':
        if (this.selecting) this.closeSelector(true);
        else this.openSelector();
        break;
      case 'Learn':
        this.setGame('learn');
        break;
      case 'Draw':
        this.setGame('draw');
        break;
      case 'Show me':
        if (this.game === 'puzzle') this.puzzleHint();
        else this.startDemo();
        break;
      case 'Rub out':
        this.rubOut();
        break;
      case 'Restart':
        this.loadLevel(this.currentIndex());
        break;
      case 'Next': {
        const next = this.currentIndex() + 1;
        if (this.game === 'draw' && next < LEVELS.length && !progress.isUnlocked(next)) {
          this.showBanner('Locked 🔒', 'Finish this kolam to unlock the next one', '#ffd98a', 2);
        } else this.loadLevel(next);
        break;
      }
    }
    this.drawButtons();
  }

  private getBoardHit(hand: Hand): Hit | null {
    this.board.updateWorldMatrix(true, false);
    this.touchHit[hand] = false;
    if (this.input.xr.isPrimary('hand', hand)) {
      const tip = this.player.indexTipSpaces[hand];
      tip.updateWorldMatrix(true, false);
      this.tmpV.setFromMatrixPosition(tip.matrixWorld);
      // Closing the fingers to pinch curls the index finger, which moves its
      // tip several centimetres — and it starts curling well before the pinch
      // counts. So the ring uses the fingertip as it was while the thumb and
      // finger were still apart, held in the hand's own frame: only moving the
      // whole hand moves the ring and the line, never closing the fingers.
      const handFrame = this.player.raySpaces[hand];
      handFrame.updateWorldMatrix(true, false);
      const inHand = handFrame.worldToLocal(this.tmpV.clone());
      const pinching = this.input.xr.getSelectState(hand).active;
      const gap = this.pinchGap(hand);
      this.lastGap[hand] = gap;
      // "Closing" = thumb and finger have come together by more than
      // PINCH_CLOSING from how far apart they were. The reference slowly
      // settles on a relaxed hand's own gap, so a loose hand works too.
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, now - this.gapTime[hand]);
      this.gapTime[hand] = now;
      let closing = pinching;
      if (gap !== null) {
        const ref = this.gapRef[hand];
        this.gapRef[hand] = ref === null || gap > ref ? gap : Math.max(gap, ref - PINCH_SETTLE * dt);
        closing ||= this.gapRef[hand]! - gap > PINCH_CLOSING;
      }
      if (!closing || !this.openTip[hand]) this.openTip[hand] = inHand;
      this.tmpV.copy(this.openTip[hand]!);
      handFrame.localToWorld(this.tmpV);
      // Touching the ground, or (when the hand points away from it) hovering
      // over it: the ring sits under the fingertip. Else where the hand points.
      // The way it worked when the pinch began is kept for the whole stroke.
      let mode: 'touch' | 'ray';
      if (!pinching) {
        const p = this.board.worldToLocal(this.tmpV.clone());
        const over = this.hitTest(p.x, p.y);
        mode = over && Math.abs(p.z) <= HAND_REACH ? 'touch' : 'ray';
        // An open hand held flat above the ground points its ray along the
        // ground, missing it, and the ring would vanish.
        if (mode === 'ray' && over && p.z > -HAND_REACH && p.z <= HOVER_REACH && !this.rayHitsBoard(hand)) mode = 'touch';
        this.tipHeld[hand] = { v: this.openTip[hand]!.clone(), mode };
      } else {
        if (!this.tipHeld[hand]) this.tipHeld[hand] = { v: this.openTip[hand]!.clone(), mode: 'ray' };
        mode = this.tipHeld[hand]!.mode;
      }
      this.board.worldToLocal(this.tmpV);
      this.tipHeight = Math.min(0.12, Math.max(0.01, this.tmpV.z));
      // Fingertip on (or near) the ground: draw right under the finger.
      const drawingByTouch = this.drawingWith === hand && this.strokeByTouch;
      if (mode === 'touch' && (drawingByTouch || this.tmpV.z <= HOVER_REACH) && this.tmpV.z >= -HAND_REACH * 3) {
        const touch = this.hitTest(this.tmpV.x, this.tmpV.y);
        if (touch) {
          this.touchHit[hand] = true;
          return touch;
        }
      }
      // A stroke drawn by touching the ground just pauses while the finger is
      // lifted — it must not leap to wherever the hand happens to point.
      if (this.drawingWith === hand && this.strokeByTouch) return null;
      // Hand further away: point at the ground and pinch (also how the
      // Meta VR Glasses and the browser emulator work best).
      this.tipHeight = 0.05;
    } else {
      this.tipHeight = 0.05;
    }
    // Drawing always follows your HAND (fingertip touch or hand ray) — eyes
    // jump around too much to draw with. Gaze is used for the buttons.
    const ray = this.player.raySpaces[hand];
    ray.updateWorldMatrix(true, false);
    const origin = new Vector3().setFromMatrixPosition(ray.matrixWorld);
    ray.getWorldQuaternion(this.tmpQ);
    this.tmpDir.set(0, 0, -1).applyQuaternion(this.tmpQ);
    return this.intersectBoard(origin, this.tmpDir);
  }

  /** Is this headset the Meta VR Glasses (a view much narrower than Quest's)? */
  private detectNarrowView(): boolean {
    // The emulator draws the glasses' view as a mask over a Quest-sized view
    if (document.querySelector('canvas[data-webxr-visibility-mask*="Glasses"]')) return true;
    const cam = this.world.renderer.xr.getCamera();
    const sub = cam.cameras?.[0];
    if (!sub) return false;
    const m = sub.projectionMatrix.elements;
    if (!m[0]) return false;
    const wide = Math.atan((1 - m[8]) / m[0]) + Math.atan((1 + m[8]) / m[0]); // left + right half-angles
    return wide * (180 / Math.PI) < 90; // Quest 3 is ~105°, the glasses 74°
  }

  /** Notice the Meta VR Glasses once VR starts, and give them their compact layout. */
  private updateGlassesView(inXR: boolean): void {
    if (!inXR) {
      this.narrowChecked = false;
      if (this.narrowView) {
        this.narrowView = false; // back to the normal layout outside VR
        this.layoutBoard();
      }
      return;
    }
    if (this.narrowChecked || !this.anchor) return;
    this.narrowChecked = true;
    const narrow = this.detectNarrowView();
    if (narrow !== this.narrowView) {
      this.narrowView = narrow;
      this.layoutBoard();
    }
  }

  /** Distance between the thumb tip and index tip (metres), or null if unknown. */
  private pinchGap(hand: Hand): number | null {
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame?.();
    const ref = xr.getReferenceSpace?.();
    const session = xr.getSession?.();
    if (!frame || !ref || !session || typeof frame.getJointPose !== 'function') return null;
    for (const src of session.inputSources) {
      if (src.handedness !== hand || !src.hand) continue;
      const th = src.hand.get('thumb-tip');
      const ix = src.hand.get('index-finger-tip');
      if (!th || !ix) return null;
      const a = frame.getJointPose(th, ref);
      const b = frame.getJointPose(ix, ref);
      if (!a || !b) return null;
      const pa = a.transform.position;
      const pb = b.transform.position;
      return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    }
    return null;
  }

  /** Does this hand's pointing ray land on the drawing ground? */
  private rayHitsBoard(hand: Hand): boolean {
    const ray = this.player.raySpaces[hand];
    ray.updateWorldMatrix(true, false);
    const origin = new Vector3().setFromMatrixPosition(ray.matrixWorld);
    const q = new Quaternion();
    ray.getWorldQuaternion(q);
    const hit = this.intersectBoard(origin, new Vector3(0, 0, -1).applyQuaternion(q));
    return !!hit && hit.zone === 'board';
  }

  private intersectBoard(origin: Vector3, dir: Vector3): Hit | null {
    const o = this.board.worldToLocal(origin.clone());
    const d = this.board.worldToLocal(origin.clone().add(dir)).sub(o);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = -o.z / d.z;
    if (t <= 0) return null;
    return this.hitTest(o.x + d.x * t, o.y + d.y * t);
  }

  /** Called once per frame: remember the latest tracked gaze. */
  private updateGaze(delta: number): void {
    if (this.player.gazeOrigin === 'tracked') {
      const eye = this.player.eyeSpace;
      eye.updateWorldMatrix(true, false);
      this.gazeOrigin.setFromMatrixPosition(eye.matrixWorld);
      eye.getWorldQuaternion(this.gazeQuat);
      this.gazeAge = 0;
    } else {
      this.gazeAge += delta;
    }
    // Gaze counts as "in use" while tracked, or for a short moment after a drop-out
    this.usingGaze = this.gazeAge < 0.4;
  }

  /** Pointing ray: your gaze (look + pinch) when available, else the hand's ray. */
  private pointerPose(hand: Hand): { origin: Vector3; quat: Quaternion } {
    if (this.usingGaze) return { origin: this.gazeOrigin.clone(), quat: this.gazeQuat.clone() };
    const ray = this.player.raySpaces[hand];
    ray.updateWorldMatrix(true, false);
    const q = new Quaternion();
    ray.getWorldQuaternion(q);
    return { origin: new Vector3().setFromMatrixPosition(ray.matrixWorld), quat: q };
  }

  /** Which button (0..n-1) a ray points at, or -1. */
  private buttonFromRay(origin: Vector3, dir: Vector3): number {
    this.btnRoot.updateWorldMatrix(true, false);
    const o = this.btnRoot.worldToLocal(origin.clone());
    const d = this.btnRoot.worldToLocal(origin.clone().add(dir)).sub(o);
    if (Math.abs(d.z) < 1e-6) return -1;
    const t = -o.z / d.z;
    if (t <= 0) return -1;
    return this.buttonAt(o.x + d.x * t, o.y + d.y * t);
  }

  /** Which button a fingertip is pressing (touching the column), or -1. */
  private buttonFromTip(world: Vector3): number {
    this.btnRoot.updateWorldMatrix(true, false);
    const l = this.btnRoot.worldToLocal(world.clone());
    if (l.z > 0.04 || l.z < -0.03) return -1;
    return this.buttonAt(l.x, l.y);
  }

  private buttonAt(x: number, y: number): number {
    if (Math.abs(x) > COL_W / 2 || Math.abs(y) > COL_H / 2) return -1;
    const i = Math.floor(((COL_H / 2 - y) / COL_H) * BUTTONS.length);
    return i >= 0 && i < BUTTONS.length ? i : -1;
  }

  /** A hand's button target: fingertip touch first, else where it points. */
  private handButton(hand: Hand): number {
    if (this.input.xr.isPrimary('hand', hand)) {
      const tip = this.player.indexTipSpaces[hand];
      tip.updateWorldMatrix(true, false);
      const b = this.buttonFromTip(new Vector3().setFromMatrixPosition(tip.matrixWorld));
      if (b >= 0) return b;
    }
    const { origin, quat } = this.pointerPose(hand);
    this.tmpQ.copy(quat);
    return this.buttonFromRay(origin, new Vector3(0, 0, -1).applyQuaternion(this.tmpQ));
  }

  private setHover(i: number): void {
    if (i === this.hoverButton) return;
    this.hoverButton = i;
    this.drawButtons();
  }

  private clickButton(i: number): void {
    kolamAudio.unlock();
    kolamAudio.tap();
    this.onButton(BUTTONS[i], i);
  }

  private hitTest(x: number, y: number): Hit | null {
    if (Math.abs(x) > HALF) return null;
    if (Math.abs(y) <= HALF) return { x, y, zone: 'board' };
    return null;
  }

  private placeBoard(viewer: Object3D, distance: number, drop: number, tiltDeg: number, scale: number): void {
    viewer.updateWorldMatrix(true, false);
    const eye = new Vector3().setFromMatrixPosition(viewer.matrixWorld);
    viewer.getWorldQuaternion(this.tmpQ);
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.tmpQ);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    this.anchor = { eye, forward, distance, drop, tiltDeg, scale };
    this.layoutBoard();
  }

  /** In VR, how much to enlarge the drawing ground for this kolam. */
  private boardZoom(scale: number): number {
    if (scale >= 1 || !this.spacing) return 1; // 2D view: no need
    return Math.min(XR_MAX_ZOOM, Math.max(1, XR_MIN_SPACING / (this.spacing * scale)));
  }

  /** Lay out the ground, notebook and buttons around the last placement. */
  private layoutBoard(): void {
    if (!this.anchor) return;
    const { eye, forward, distance, drop, tiltDeg, scale } = this.anchor;
    const bscale = scale * this.boardZoom(scale);
    const up = new Vector3(0, 1, 0);
    const toward = forward.clone().negate();
    const pos = eye.clone().addScaledVector(forward, distance);
    pos.y = eye.y - drop;

    // Lay the drawing ground almost flat, tilted towards the player.
    // Local +Z (the surface normal) points up-and-towards-you;
    // local +Y (the top of the kolam) points away from you.
    const t = (tiltDeg * Math.PI) / 180;
    const zAxis = up.clone().multiplyScalar(Math.cos(t)).addScaledVector(toward, Math.sin(t)).normalize();
    const yAxis = forward.clone().multiplyScalar(Math.cos(t)).addScaledVector(up, Math.sin(t)).normalize();
    const xAxis = new Vector3().crossVectors(yAxis, zAxis).normalize();
    this.board.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
    this.board.position.copy(pos);
    this.board.scale.setScalar(bscale);
    for (const g of [this.hud, this.btnRoot, this.bannerRoot]) g.scale.setScalar(scale);

    // Title, pop-ups, notebook and score panel stand upright just beyond the
    // far edge of the ground patch, facing you.
    const far = pos.clone().addScaledVector(yAxis, HALF * bscale + 0.06 * scale).addScaledVector(up, 0.13 * scale);
    this.hud.position.copy(far);
    this.hud.lookAt(eye.x, far.y + (eye.y - far.y) * 0.35, eye.z);

    // Button column: to the right of the patch, about hand height, facing you
    const right = new Vector3().crossVectors(forward, up).normalize();
    const side = settings.leftHanded ? -1 : 1;
    const zoom = bscale / scale;
    this.book.position.set(-side * (HALF * zoom + PAGE_W - 0.02), -0.12, 0.12);
    this.book.rotation.set(-0.2, side * 0.5, 0);
    this.status.mesh.position.set(side * (HALF * zoom + 0.24), 0.12, -0.02);
    this.status.mesh.rotation.set(-0.1, -side * 0.5, 0);
    const col = pos.clone().addScaledVector(right, side * (HALF * bscale + (COL_W / 2 + 0.05) * scale)).addScaledVector(up, (COL_H / 2 - 0.04) * scale);
    this.btnRoot.position.copy(col);
    this.btnRoot.lookAt(eye);
  }

  // ===========================================================================
  // Drawing + tracing
  // ===========================================================================
  private beginStroke(who: Hand | 'mouse', p: P2): void {
    if (this.complete || this.demoActive || this.failTimer > 0 || this.pendingErase) return;
    if (this.tutorial && this.tutorialStep === 1) {
      this.tutorialStep = 2;
      this.showBanner('Now draw along the faint line', 'Loop around the dots — never touch one', '#ffe2a0', 4);
    }
    this.timing = true;
    this.drawingWith = who;
    this.lastPoint = p;
    this.track = null;
    this.strokeStart = { x: p.x, y: p.y };
    let near = Infinity;
    for (const q of this.samples) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
    this.strokeStartedOff = near > this.spacing * JUDGE.catchLine;
    this.strokeByTouch = who !== 'mouse' && this.touchHit[who];
    this.dotOver = -1;
    this.dotOverCount = 0;
    this.stroke = { inkStart: this.ink.vertexCount, covered: [], dots: [], ink: 0, stray: 0, flour: 0, run: 0, alerted: false, goodInk: this.ink.vertexCount, sinceInk: 0, sinceStray: 0, sinceFlour: 0, sinceDots: [], path: 0, pathAnchor: { x: p.x, y: p.y }, along: new Set<number>(), goAlong: 0, goAcross: 0, pts: [{ x: p.x, y: p.y, ink: this.ink.vertexCount, flour: 0, cov: 0 }] };
    this.strokes.push(this.stroke);
    this.markTraced(p, p);
    this.checkDots(p);
  }

  private endStroke(evaluate = false): void {
    this.smooth = null;
    this.releaseTimer = 0;
    this.drawingWith = null;
    this.lastPoint = null;
    // Let go with the line ending on a dot: that is touching it
    if (evaluate && this.stroke && this.dotOver >= 0 && this.dotOverCount > 0 && !this.dotTouched[this.dotOver] && !this.complete && this.failTimer <= 0) {
      this.touchDot(this.dotOver);
      if (!this.stroke) return; // already judged and rubbed out
    }
    this.dotOver = -1;
    this.dotOverCount = 0;
    const st = this.stroke;
    this.stroke = null;
    if (!evaluate || !st || this.complete || this.failTimer > 0) return;
    if (st.ink === 0 && st.covered.length === 0 && st.dots.length === 0) {
      this.strokes.pop(); // just a tap
      return;
    }
    if (this.strict && this.isScribble(st, SCRIBBLE_RATIO)) {
      this.stroke = st;
      this.spoilStroke('Scribble', true);
      return;
    }
    if (this.mode === 'hard' && this.isSpoiled(st)) {
      this.stroke = st; // judge it as the current (last) stroke
      this.spoilStroke(st.dots.length ? 'Touched a dot' : 'Off the kolam');
    }
  }

  /** Is the part of the stroke before the mistake a real stretch of kolam line? */
  private goodPartIsKolam(st: Stroke): boolean {
    if (st.covered.length < this.perSpacing * KEEP_MIN) return false;
    const kept = st.pts.filter((q) => q.ink <= st.goodInk);
    let path = 0;
    for (let i = 1; i < kept.length; i++) path += Math.hypot(kept[i].x - kept[i - 1].x, kept[i].y - kept[i - 1].y);
    const line = (st.covered.length * this.spacing) / Math.max(1, this.perSpacing);
    if (path > SCRIBBLE_RATIO * Math.max(line, this.spacing * 0.05)) return false;
    return this.matchShare(kept) >= MATCH_MIN;
  }

  /**
   * How much of the stroke matches the kolam: each part must lie near a kolam
   * line AND run the same way as that line. Direction is taken over a short
   * stretch either side, so hand shake doesn't count against you.
   */
  private matchShare(pts: P2[]): number {
    if (pts.length < 3) return 1;
    const nearIn = (this.spacing * MATCH_NEAR) ** 2;
    const nearOut = (this.spacing * JUDGE.outerLoop) ** 2; // outer loops may be drawn a little wide
    const span = Math.max(1, Math.round(MATCH_SPAN / 0.05));
    const n = this.samples.length;
    let ok = 0;
    let all = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - span)];
      const b = pts[Math.min(pts.length - 1, i + span)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dl = Math.hypot(dx, dy);
      if (dl < this.spacing * 0.05) continue; // hardly moving here
      all++;
      const p = pts[i];
      const near2 = this.outsideDots(p) ? nearOut : nearIn;
      for (let j = 0; j < n; j++) {
        const q = this.samples[j];
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 > near2) continue;
        const r = this.samples[j < n - 1 && !this.isGap[j] ? j + 1 : Math.max(0, j - 1)];
        const tx = r.x - q.x;
        const ty = r.y - q.y;
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-9 && Math.abs((tx * dx + ty * dy) / (tl * dl)) >= MATCH_COS) {
          ok++;
          break;
        }
      }
    }
    return all ? ok / all : 1;
  }

  /**
   * A scribble: lots of flour but hardly any distance along the kolam line
   * (wiggling back and forth across a line stays "near" it all the time).
   */
  private isScribble(st: Stroke, ratio: number): boolean {
    // Short dashes count too: a dash cut ACROSS a line covers almost none of it.
    if (st.path < this.spacing * SCRIBBLE_MIN) return false;
    if (this.matchShare(st.pts) < MATCH_MIN) return true;
    // mostly sideways to the line (a dash cut at an angle across the weave)
    if (st.goAcross > SCRIBBLE_SIDEWAYS * st.goAlong && st.goAcross + st.goAlong > this.spacing * 0.12) return true;
    const along = (st.along.size * this.spacing) / Math.max(1, this.perSpacing);
    return st.path > ratio * Math.max(along, this.spacing * 0.05);
  }

  /** Real draw-mode drawing (not Learn, not the guided first kolam). */
  private get strict(): boolean {
    return this.mode === 'hard' && !this.tutorial;
  }

  private isSpoiled(st: { dots: number[]; ink: number; stray: number }): boolean {
    return st.dots.length > 0 || (st.ink >= 4 && st.stray / st.ink > JUDGE.strayRatio);
  }

  /**
   * A line went wrong: like rubbing a spoiled bit of kolam away with your
   * hand, it is wiped straight away and costs a lamp. Draw it again.
   */
  private spoilStroke(reason: string, wholeStroke = false): void {
    if (this.complete || this.failTimer > 0) return;
    // Pinched BESIDE the line (aimed a little off) and never reached it: just
    // clear it and say where to start — no lamp lost. A stroke that starts on
    // the line and goes wrong is a real mistake and costs a lamp as usual.
    const st = this.stroke;
    if (st && this.strokeStartedOff && st.covered.length === 0 && st.dots.length === 0 && this.strokes[this.strokes.length - 1] === st) {
      this.endStroke(false);
      this.wipeLastStroke();
      kolamAudio.tap();
      this.showBanner('Start on the kolam line', 'Aim the gold ring where the line runs between the dots, then pinch', '#ffe2a0', 3, true);
      return;
    }
    // Keep the good part only if it really is a stretch of kolam line: long
    // enough, and itself following the kolam (not a scribble that happened to
    // stay near the lines — in a small kolam everything is near a line).
    if (!wholeStroke && st && !this.goodPartIsKolam(st)) wholeStroke = true;
    this.endStroke(false);
    // Don't rub it out at once: the wrong part turns red and stays a moment,
    // so you can see what went wrong. Then it is rubbed out.
    const last = this.strokes[this.strokes.length - 1];
    if (last) {
      this.paintInk(wholeStroke ? last.inkStart : last.goodInk, this.ink.vertexCount, INK_BAD);
      // The white flour would hide the red line: brush it off the wrong part now.
      if (wholeStroke) { this.flour.eraseLast(last.flour); last.flour = 0; }
      else { this.flour.eraseLast(last.sinceFlour); last.flour -= last.sinceFlour; last.sinceFlour = 0; }
      this.pendingErase = { timer: MISTAKE_SHOW, whole: wholeStroke };
    }
    this.rimFlash = 1;
    kolamAudio.bump();
    if (this.tutorial) {
      this.showBanner(`${reason}!`, 'The red part is rubbed out — carry on from there (no lamps lost while you learn)', '#ffd98a', MISTAKE_BANNER, true);
      return;
    }
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 0) {
      // Three mistakes: the kolam starts again — after a pause long enough to
      // see what went wrong and read why.
      this.failTimer = RESET_PAUSE;
      this.showBanner('All lamps went out', `${reason} — 3rd mistake · this kolam starts again`, '#ff6b6b', RESET_PAUSE, true);
    } else {
      this.showBanner(
        `${reason}!`,
        `${wholeStroke ? 'That line is rubbed out — draw along the kolam line' : 'The red part is rubbed out — carry on from there'} · ${this.lives} ${this.lives === 1 ? 'lamp' : 'lamps'} left`,
        '#ff6b6b',
        MISTAKE_BANNER,
        true,
      );
    }
    this.drawLabel();
  }

  /** ↶ Rub out button: wipe your last line yourself (free — tidy up any time). */
  private rubOut(): void {
    if (this.complete || this.failTimer > 0 || this.game === 'puzzle') return;
    if (this.pendingErase) {
      this.finishPendingErase(); // the red mistake goes now
      return;
    }
    if (this.drawingWith) this.endStroke(true);
    if (!this.strokes.length) {
      this.showBanner('Nothing to rub out', 'Draw a line first', '#ffe2a0', 1.4, true);
      return;
    }
    this.wipeLastStroke();
    kolamAudio.tap();
    this.showBanner('Rubbed out', 'Draw it again', '#ffe2a0', 1.3, true);
  }

  /** Rub out only the wrong end of the last stroke; keep everything drawn correctly. */
  private trimLastStroke(): void {
    const st = this.strokes[this.strokes.length - 1];
    if (!st) return;
    this.ink.vertexCount = st.goodInk;
    this.ink.geometry.setDrawRange(0, st.goodInk);
    this.flour.eraseLast(st.sinceFlour);
    st.flour -= st.sinceFlour;
    st.ink -= st.sinceInk;
    st.stray -= st.sinceStray;
    this.inkPoints -= st.sinceInk;
    this.strayPoints -= st.sinceStray;
    for (const d of st.sinceDots) {
      this.dotTouched[d] = false;
      this.dotMaterials[d].color.setHex(COLOR_DOT);
      this.mistakes = Math.max(0, this.mistakes - 1);
      const k = st.dots.indexOf(d);
      if (k >= 0) st.dots.splice(k, 1);
    }
    if (st.cutCovered !== undefined && st.cutCovered < st.covered.length) {
      const gone = st.covered.splice(st.cutCovered);
      for (const k of gone) {
        if (!this.covered[k]) continue;
        this.covered[k] = false;
        this.coveredCount--;
      }
      for (const k of gone) {
        this.recolorSegment(k);
        if (k > 0) this.recolorSegment(k - 1);
      }
    }
    st.cutCovered = undefined;
    st.sinceInk = st.sinceStray = st.sinceFlour = 0;
    st.sinceDots = [];
    if (st.ink <= 0 && st.covered.length === 0) this.strokes.pop();
    this.almostShown = false;
    this.drawLabel();
  }

  /** Colour ink vertices [from, to) — e.g. red for a mistake about to be rubbed out. */
  private paintInk(from: number, to: number, c: Color): void {
    const col = this.ink.colors;
    if (!col) return;
    for (let v = Math.max(0, from); v < to; v++) {
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
    const attr = this.ink.geometry.getAttribute('color');
    if (attr) attr.needsUpdate = true;
  }

  /** The red mistake has been shown long enough: rub it out now. */
  private finishPendingErase(): void {
    const pe = this.pendingErase;
    if (!pe) return;
    this.pendingErase = null;
    if (pe.whole) this.wipeLastStroke();
    else this.trimLastStroke();
  }

  /** Remove the last stroke completely: its line, flour, progress and red dots. */
  private wipeLastStroke(): void {
    const st = this.strokes.pop();
    if (!st) return;
    this.ink.vertexCount = st.inkStart;
    this.ink.geometry.setDrawRange(0, st.inkStart);
    this.flour.eraseLast(st.flour);
    for (const i of st.covered) {
      if (!this.covered[i]) continue;
      this.covered[i] = false;
      this.coveredCount--;
    }
    for (const i of st.covered) {
      this.recolorSegment(i);
      if (i > 0) this.recolorSegment(i - 1);
    }
    for (const d of st.dots) {
      this.dotTouched[d] = false;
      this.dotMaterials[d].color.setHex(COLOR_DOT);
      this.mistakes = Math.max(0, this.mistakes - 1);
    }
    this.inkPoints -= st.ink;
    this.strayPoints -= st.stray;
    this.almostShown = false;
    this.drawLabel();
  }

  /** Should traced parts of the kolam light up (Learn / guided first kolam)? */
  private get revealTrace(): boolean {
    return !this.strict;
  }

  private recolorSegment(j: number): void {
    if (!this.guide || j < 0 || j >= this.samples.length - 1) return;
    const lit = this.revealTrace && this.covered[j] && this.covered[j + 1];
    this.guide.setSegmentColor(j, lit ? COLOR_TRACED : this.guideVisible ? COLOR_GUIDE : this.groundColor());
  }

  /** Finish only when the kolam is covered AND no wrong line is left on it. */
  private tryFinish(): void {
    if (this.complete || this.pendingErase || this.progress() < MODE_SETTINGS[this.mode].completeAt) return;
    if (this.mode === 'hard' && this.strokes.some((st) => this.isSpoiled(st))) {
      const now = performance.now();
      if (!this.almostShown || now - this.almostAt > 8000) {
        this.almostShown = true;
        this.almostAt = now;
        this.showBanner('Almost!', 'Rub out the wrong lines first, then finish them', '#ffd98a', 2.4, true);
      }
      return;
    }
    this.finishLevel();
  }

  private addPoint(p: P2): void {
    const last = this.lastPoint;
    if (!last || this.complete) return;
    const stepLen = Math.hypot(p.x - last.x, p.y - last.y);
    if (stepLen < MIN_STEP) return;
    this.drawnThisFrame += stepLen;
    const grains = Math.min(5, 1 + Math.round(stepLen / 0.003));
    this.flour.emit(p.x, p.y, this.tipHeight, grains);
    if (this.stroke) {
      this.stroke.flour += grains;
      this.stroke.sinceFlour += grains;
      const lp = this.stroke.pts[this.stroke.pts.length - 1];
      if (!lp || Math.hypot(p.x - lp.x, p.y - lp.y) >= this.spacing * 0.05) this.stroke.pts.push({ x: p.x, y: p.y, ink: this.ink.vertexCount, flour: this.stroke.flour, cov: this.stroke.covered.length });
      // count the flour path in coarse steps, so fingertip jitter doesn't add up
      const an = this.stroke.pathAnchor;
      const d = an ? Math.hypot(p.x - an.x, p.y - an.y) : 0;
      if (!an || d >= this.spacing * 0.12) {
        this.stroke.path += d;
        // compare this step's direction with the line you're on
        if (an && this.track) {
          const q0 = this.samples[this.sampleAt(this.track.loop, this.track.k)];
          const q1 = this.samples[this.sampleAt(this.track.loop, this.track.k + 1)];
          const tl = Math.hypot(q1.x - q0.x, q1.y - q0.y);
          if (tl > 1e-9) {
            const tx = (q1.x - q0.x) / tl;
            const ty = (q1.y - q0.y) / tl;
            const sx = p.x - an.x;
            const sy = p.y - an.y;
            this.stroke.goAlong += Math.abs(sx * tx + sy * ty);
            this.stroke.goAcross += Math.abs(sx * ty - sy * tx);
          }
        }
        this.stroke.pathAnchor = { x: p.x, y: p.y };
      }
    }
    // Is this bit of the stroke on the kolam?
    let near: boolean;
    let reason = 'Off the kolam';
    if (this.strict) {
      const r = this.followLine(last, p);
      near = r.ok;
      if (r.jumped) reason = 'Jumped to another line';
    } else {
      near = this.onKolam(last, p);
    }
    // In Draw mode what you see is YOUR line, exactly where you drew it:
    // rice-flour white on the kolam, red where it strays. (In Learn mode the
    // kolam itself lights up, and only strays are drawn.)
    if (this.strict) {
      this.ink.addSegment(last, p, this.inkWidth, 0.003, near ? (settings.highContrast ? INK_GOOD_HC : INK_GOOD) : INK_BAD);
    } else if (!near) {
      this.ink.addSegment(last, p, this.inkWidth * 0.7, 0.003, INK_BAD);
    }
    if (this.mode === 'hard') {
      this.inkPoints++;
      if (!near) this.strayPoints++;
      const st = this.stroke;
      if (st) {
        st.ink++;
        if (!near) st.stray++;
        if (near) {
          // Everything up to here is good and will be kept
          st.goodInk = this.ink.vertexCount;
          st.sinceInk = 0;
          st.sinceStray = 0;
          st.sinceFlour = 0;
          st.sinceDots = [];
        } else {
          st.sinceInk++;
          st.sinceStray++;
        }
        // Warn right away, while you are still drawing
        st.run = near ? 0 : st.run + stepLen;
        const runLimit = reason === 'Jumped to another line' ? JUDGE.jumpRun : JUDGE.offRun;
        if (!st.alerted && (st.run > this.spacing * runLimit || (st.ink >= 6 && st.stray / st.ink > JUDGE.strayRatio))) {
          st.alerted = true;
          this.spoilStroke(reason);
          return;
        }
      }
    }
    if (!this.strict) this.markTraced(last, p);
    this.checkDots(p, last);
    if (this.drawingWith) this.lastPoint = { x: p.x, y: p.y }; // not if a mistake just ended the stroke
    // Scribbling on and on? Rub it out without waiting for you to let go.
    const st = this.stroke;
    if (this.strict && st && this.drawingWith && st.path > this.spacing * 2 && this.isScribble(st, SCRIBBLE_RATIO_LIVE)) {
      this.spoilStroke('Scribble', true);
    }
  }

  private buildLoops(): void {
    this.loopStart = [];
    this.loopLen = [];
    this.loopOf = new Array(this.samples.length).fill(0);
    let start = 0;
    const n = this.samples.length;
    for (let i = 1; i <= n; i++) {
      if (i === n || this.isGap[i - 1]) {
        const id = this.loopStart.length;
        this.loopStart.push(start);
        this.loopLen.push(Math.max(1, i - start - 1)); // last sample repeats the first
        for (let k = start; k < i; k++) this.loopOf[k] = id;
        start = i;
      }
    }
    let total = 0;
    for (let i = 0; i < n - 1; i++) if (!this.isGap[i]) total += Math.hypot(this.samples[i + 1].x - this.samples[i].x, this.samples[i + 1].y - this.samples[i].y);
    this.perSpacing = total > 0 ? Math.max(4, (n / total) * this.spacing) : 10;
    this.track = null;
  }

  private sampleAt(loop: number, k: number): number {
    const L = this.loopLen[loop];
    return this.loopStart[loop] + (((k % L) + L) % L);
  }

  private markSample(g: number): boolean {
    if (this.covered[g]) return false;
    this.covered[g] = true;
    this.coveredCount++;
    this.stroke?.covered.push(g);
    this.recolorSegment(g);
    if (g > 0) this.recolorSegment(g - 1);
    // The loop's first sample is repeated at its end
    const loop = this.loopOf[g];
    const L = this.loopLen[loop];
    const s0 = this.loopStart[loop];
    const twin = g === s0 ? s0 + L : g === s0 + L ? s0 : -1;
    if (twin >= 0 && twin < this.samples.length && !this.covered[twin]) {
      this.covered[twin] = true;
      this.coveredCount++;
      this.stroke?.covered.push(twin);
      this.recolorSegment(twin);
      if (twin > 0) this.recolorSegment(twin - 1);
    }
    return true;
  }

  /**
   * Draw mode: your finger must stay on ONE line of the kolam and follow it —
   * straight through crossings, curving round the outer dots. Returns ok=false
   * when you leave the line; jumped=true if you hopped onto a different line.
   */
  private followLine(a: P2, p: P2): { ok: boolean; jumped: boolean } {
    const lim = this.spacing * JUDGE.catchLine;
    const lim2 = lim * lim;
    // Past the last row of dots only the outer loops run, so there you may
    // draw a loop a little wide without it counting as a mistake.
    const outside = this.outsideDots(p);
    const stay = this.spacing * (outside ? JUDGE.outerLoop : JUDGE.stayOnLine);
    const catchR = outside ? stay : lim;
    const d2 = (i: number) => {
      const q = this.samples[i];
      return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    };

    if (!this.track) {
      // Wait until you've moved a little, so we know which way you're going
      const s0 = this.strokeStart ?? a;
      const moved = Math.hypot(p.x - s0.x, p.y - s0.y);
      if (moved < this.spacing * 0.12) return { ok: true, jumped: false };
      const dx = p.x - s0.x;
      const dy = p.y - s0.y;
      let best = -1;
      let bestD = catchR * catchR;
      const n = this.samples.length;
      for (let i = 0; i < n; i++) {
        const dd = d2(i);
        if (dd > bestD) continue;
        const nb = this.samples[i < n - 1 && !this.isGap[i] ? i + 1 : Math.max(0, i - 1)];
        const tx = nb.x - this.samples[i].x;
        const ty = nb.y - this.samples[i].y;
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-9 && Math.abs((tx * dx + ty * dy) / (tl * moved)) < 0.6) continue;
        best = i;
        bestD = dd;
      }
      if (best < 0) return { ok: false, jumped: false };
      const loop = this.loopOf[best];
      this.track = { loop, k: best - this.loopStart[loop] };
      this.markSample(best);
      return { ok: true, jumped: false };
    }

    // Look only a short way along YOUR line, either direction
    const { loop } = this.track;
    const W = Math.max(3, Math.round(this.perSpacing * 0.8));
    let bestK = 0;
    let bestD = stay * stay;
    let found = false;
    for (let dk = -W; dk <= W; dk++) {
      const dd = d2(this.sampleAt(loop, this.track.k + dk));
      if (dd <= bestD) {
        bestD = dd;
        bestK = dk;
        found = true;
      }
    }
    if (found) {
      let changed = false;
      const step = bestK >= 0 ? 1 : -1;
      for (let dk = 0; dk !== bestK + step; dk += step) changed = this.markSample(this.sampleAt(loop, this.track.k + dk)) || changed;
      if (this.stroke) for (let dk = 0; dk !== bestK + step; dk += step) this.stroke.along.add(this.sampleAt(loop, this.track.k + dk));
      this.track.k += bestK;
      if (changed) {
        this.drawLabel();
        this.tryFinish();
      }
      return { ok: true, jumped: false };
    }
    // Not on your line any more — on a different one?
    for (let i = 0; i < this.samples.length; i++) if (d2(i) <= lim2) return { ok: false, jumped: true };
    return { ok: false, jumped: false };
  }

  /**
   * Is the stroke a→b on the kolam? It must be close to a kolam line AND run
   * the same way as that line — a woven kolam has lines everywhere, so being
   * merely "near some line" isn't enough.
   */
  private onKolam(a: P2, b: P2): boolean {
    const lim = this.spacing * (this.strict ? 0.26 : 0.3);
    const lim2 = lim * lim;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return true;
    const minCos = this.strict ? 0.75 : 0.5;
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const q = this.samples[i];
      const ex = q.x - b.x;
      const ey = q.y - b.y;
      if (ex * ex + ey * ey > lim2) continue;
      const nb = this.samples[i < n - 1 && !this.isGap[i] ? i + 1 : Math.max(0, i - 1)];
      const tx = nb.x - q.x;
      const ty = nb.y - q.y;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-9) continue;
      if (Math.abs((tx * dx + ty * dy) / (tl * len)) >= minCos) return true;
    }
    return false;
  }

  /** Light up every part of the kolam that the stroke a→b passes over. */
  private markTraced(a: P2, b: P2): void {
    if (!this.guide) return;
    const tol2 = this.tolerance * this.tolerance;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-10) return; // need a direction to know which line you are drawing
    const len = Math.sqrt(len2);
    let changed = false;
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      if (this.covered[i]) continue;
      const q = this.samples[i];
      // Only the line running the SAME way as your stroke counts. Where two
      // lines cross in an X, the other one is at ~90° and is left alone.
      const nb = this.samples[i < n - 1 && !this.isGap[i] ? i + 1 : Math.max(0, i - 1)];
      const tx = nb.x - q.x;
      const ty = nb.y - q.y;
      const tl = Math.hypot(tx, ty);
      if (tl > 1e-9 && Math.abs((tx * abx + ty * aby) / (tl * len)) < 0.45) continue;
      const t = ((q.x - a.x) * abx + (q.y - a.y) * aby) / len2;
      // Only what lies alongside this stroke (plus a little overlap so the
      // joins between strokes don't leave gaps) — never far ahead of it.
      const slack = (this.tolerance * 0.5) / len;
      if (t < -slack || t > 1 + slack) continue;
      const dx = a.x + abx * t - q.x;
      const dy = a.y + aby * t - q.y;
      if (dx * dx + dy * dy <= tol2) {
        this.covered[i] = true;
        this.coveredCount++;
        this.stroke?.covered.push(i);
        this.recolorSegment(i);
        if (i > 0) this.recolorSegment(i - 1);
        changed = true;
      }
    }
    if (changed) {
      this.fillSmallGaps();
      this.drawLabel();
      this.tryFinish();
    }
  }

  /**
   * A short unlit piece of a line with gold on both sides is filled in, so a
   * hand that wobbles for a moment doesn't leave little breaks to redo.
   */
  private fillSmallGaps(): void {
    if (!this.guide) return;
    const n = this.samples.length;
    // About 0.45 dot spacings of line
    let perSpacing = 14;
    if (n > 1) {
      let total = 0;
      for (let i = 0; i < n - 1; i++) if (!this.isGap[i]) total += Math.hypot(this.samples[i + 1].x - this.samples[i].x, this.samples[i + 1].y - this.samples[i].y);
      perSpacing = Math.max(4, Math.round((n / total) * this.spacing));
    }
    const maxGap = Math.round(perSpacing * 0.45);
    let i = 0;
    while (i < n) {
      if (this.covered[i]) {
        i++;
        continue;
      }
      // Run of uncovered samples [i, j)
      let j = i;
      let crossesLine = false;
      while (j < n && !this.covered[j]) {
        if (j > i && this.isGap[j - 1]) crossesLine = true;
        j++;
      }
      const prevOk = i > 0 && this.covered[i - 1] && !this.isGap[i - 1];
      const nextOk = j < n && this.covered[j] && !this.isGap[j - 1];
      if (prevOk && nextOk && !crossesLine && j - i <= maxGap) {
        for (let k = i; k < j; k++) {
          this.covered[k] = true;
          this.coveredCount++;
          this.stroke?.covered.push(k);
          this.recolorSegment(k);
          if (k > 0) this.recolorSegment(k - 1);
        }
      }
      i = j;
    }
  }

  private progress(): number {
    return this.countable ? this.coveredCount / this.countable : 0;
  }

  /**
   * Touching a dot is the first kolam rule. The whole step from `from` to `p`
   * is checked (a quick hand can jump right over a dot between two frames).
   * A touch counts when the line stays on the dot for two points, when one
   * step runs right across it, or when you let go on it (see endStroke).
   */
  private checkDots(p: P2, from?: P2): void {
    const hit = this.spacing * JUDGE.dotHit;
    const a = from ?? p;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const l2 = dx * dx + dy * dy;
    let over = -1;
    let across = false;
    let best = Infinity;
    this.dotCenters.forEach((c, i) => {
      if (this.dotTouched[i]) return;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2)) : 1;
      const d = Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y);
      if (d < hit && d < best) {
        best = d;
        over = i;
        across = t > 0 && t < 1 && Math.sqrt(l2) > hit; // the step ran right over it
      }
    });
    if (over < 0 || over !== this.dotOver) this.dotOverCount = 0;
    this.dotOver = over;
    if (over < 0) return;
    this.dotOverCount++;
    if (this.dotOverCount >= JUDGE.dotPoints || across) this.touchDot(over);
  }

  /** Your line touched dot `i`: it turns red, and in Draw mode it costs a lamp. */
  private touchDot(i: number): void {
    this.dotTouched[i] = true;
    this.dotMaterials[i].color.setHex(COLOR_DOT_BAD);
    this.mistakes++;
    const st = this.stroke;
    st?.dots.push(i);
    st?.sinceDots.push(i);
    kolamAudio.bump();
    this.drawLabel();
    if (this.mode === 'hard' && st && !st.alerted) {
      st.alerted = true;
      this.cutBeforeDot(st, i);
      this.spoilStroke('Touched a dot');
    }
  }

  /**
   * Rub the line out back to where it came near the dot, so no white line is
   * left touching it (the bit before that, if it was on the kolam, stays).
   */
  private cutBeforeDot(st: Stroke, i: number): void {
    const c = this.dotCenters[i];
    const r = this.spacing * 0.3;
    let j = st.pts.length - 1;
    while (j > 0 && Math.hypot(st.pts[j].x - c.x, st.pts[j].y - c.y) < r) j--;
    const q = st.pts[j];
    if (!q || q.ink >= st.goodInk) return;
    st.goodInk = q.ink;
    st.sinceFlour = st.flour - q.flour;
    st.sinceInk = Math.min(st.ink, Math.round((this.ink.vertexCount - q.ink) / 6));
    st.sinceStray = Math.min(st.stray, st.sinceStray);
    st.cutCovered = q.cov;
  }

  private stars(): number {
    if (this.game === 'puzzle') {
      const par = PUZZLES[this.puzzleIndex].par;
      const extra = this.moves - par + this.hints * 2;
      if (extra <= 0) return 3;
      if (extra <= 3) return 2;
      return 1;
    }
    if (this.mode === 'hard') {
      const acc = this.accuracy();
      const byAccuracy = acc >= 0.88 ? 3 : acc >= 0.7 ? 2 : 1;
      return Math.max(1, Math.min(byAccuracy, this.lives));
    }
    if (this.mistakes === 0) return 3;
    if (this.mistakes <= 2) return 2;
    return 1;
  }

  private accuracy(): number {
    return this.inkPoints ? 1 - this.strayPoints / this.inkPoints : 1;
  }

  private timeText(): string {
    const t = Math.floor(this.levelTime);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  private finishLevel(): void {
    this.complete = true;
    this.completeTimer = NEXT_LEVEL_DELAY;
    this.festivePhase = 0;
    this.endStroke();
    this.ink.clear();
    this.flour.clear();
    this.dotMaterials.forEach((m) => m.color.setHex(COLOR_DOT));
    this.drawLabel();
    kolamAudio.bell();
    if (this.tutorial) {
      this.showBanner('Your first kolam!', 'Next: no guide — follow ONE line, straight through crossings', '#ffd98a', NEXT_LEVEL_DELAY - 0.3);
    } else if (this.mode === 'hard' && this.game !== 'puzzle') {
      const st = this.stars();
      this.showBanner(
        `Beautiful!  ${'★'.repeat(st)}${'☆'.repeat(3 - st)}`,
        `${Math.round(this.accuracy() * 100)}% accurate · ${this.timeText()} · ${this.lives} ${this.lives === 1 ? 'lamp' : 'lamps'} left`,
        '#ffd98a',
        NEXT_LEVEL_DELAY - 0.3,
      );
    } else if (this.game === 'puzzle') {
      this.showBanner('One line!', 'The kolam is a single unbroken line', '#7bd389', NEXT_LEVEL_DELAY - 0.3);
    } else {
      this.showBanner('Beautiful!', 'Well traced', '#ffd98a', NEXT_LEVEL_DELAY - 0.3);
    }
    if (this.daily) {
      const streak = progress.completeDaily();
      this.showBanner("Today's kolam drawn!", `${streak}-day streak · a new kolam waits tomorrow`, '#ffd98a', NEXT_LEVEL_DELAY - 0.3);
    } else if (this.game === 'draw') {
      progress.complete(this.levelIndex, this.stars(), this.accuracy(), Math.floor(this.levelTime), LEVELS.length);
    }
  }

  private animateFestive(delta: number): void {
    if (!this.guide) return;
    this.festivePhase += delta * 0.35;
    const n = this.samples.length - 1;
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const f = ((i / n) * 3 + this.festivePhase) % 1;
      const k = f * FESTIVE.length;
      c.copy(FESTIVE[Math.floor(k) % FESTIVE.length]).lerp(FESTIVE[(Math.floor(k) + 1) % FESTIVE.length], k - Math.floor(k));
      this.guide.setSegmentColor(i, c);
    }
  }

  // ===========================================================================
  // "Show me" demo
  // ===========================================================================
  /**
   * While Show me draws, your own lines, their flour and the Learn guide fade
   * to faint so the pen's line stands out; afterwards they come back as they were.
   */
  private updateDemoDim(delta: number): void {
    const target = this.demoActive ? DEMO_DIM : 1;
    if (this.demoDim === target) return;
    this.demoDim += (target - this.demoDim) * (1 - Math.exp(-delta * 6));
    if (Math.abs(target - this.demoDim) < 0.01) this.demoDim = target;
    const faded = this.demoDim < 1;
    for (const m of [this.inkMat, this.guideMat]) {
      if (!m) continue;
      m.transparent = faded;
      m.opacity = this.demoDim;
    }
    (this.flour.points.material as { opacity: number }).opacity = 0.85 * this.demoDim;
  }

  private startDemo(): void {
    if (this.complete || !this.demo || !this.demoMat) return;
    this.endStroke();
    this.demo.clear();
    this.demoDrawn = 0;
    this.demoT = 0;
    this.demoFade = 0;
    this.demoMat.opacity = 0.9;
    const total = this.demoCumLen[this.demoCumLen.length - 1];
    this.demoDuration = Math.min(DEMO_MAX_SECONDS, Math.max(DEMO_MIN_SECONDS, total / DEMO_SPEED));
    this.demoActive = true;
    this.demoHead.visible = true;
    // You pressed the button while looking at the buttons: wait until your eyes
    // are on the ground (or a few seconds), so the first strokes aren't missed.
    this.demoWaiting = true;
    this.demoWait = 0;
    this.demoLooking = 0;
    const s = this.samples[0];
    if (s) this.demoHead.position.set(s.x, s.y, 0.004);
    this.showBanner('Watch the ground', 'The pen draws the kolam for you', '#ffe2a0', 2.2);
    this.drawLabel();
  }

  /**
   * Nearly done but stopped drawing? After a few quiet seconds the bits of the
   * line still missing glow softly, so you know what is left to draw.
   */
  private updateHint(delta: number): void {
    if (!this.hint || !this.hintMat) return;
    if (this.hintTime > 0) {
      this.hintTime -= delta;
      const t = HINT_SECONDS - this.hintTime;
      this.hintMat.opacity = 0.75 * Math.min(1, t / 0.4, Math.max(0, this.hintTime) / 0.6) * (0.75 + 0.25 * Math.sin(t * 6));
      if (this.hintTime <= 0 || this.drawingWith) {
        this.hintTime = 0;
        this.hintMat.opacity = 0;
      }
      return;
    }
    this.hintCooldown = Math.max(0, this.hintCooldown - delta);
    const quiet = !this.strict || this.complete || this.drawingWith || this.demoActive || this.selecting || this.settingsOpen || this.failTimer > 0;
    this.idleTime = quiet ? 0 : this.idleTime + delta;
    if (this.idleTime < HINT_AFTER_IDLE || this.hintCooldown > 0 || this.progress() < HINT_FROM_PROGRESS) return;
    this.hint.clear();
    const w = Math.max(0.0035, this.spacing * 0.09) * 0.9;
    for (let i = 0; i < this.samples.length - 1; i++) {
      if (this.isGap[i] || (this.covered[i] && this.covered[i + 1])) continue;
      this.hint.addSegment(this.samples[i], this.samples[i + 1], w, 0.0028);
    }
    if (this.hint.vertexCount === 0) return;
    this.hintTime = HINT_SECONDS;
    this.hintCooldown = HINT_REPEAT;
    this.idleTime = 0;
    this.showBanner('Almost there', 'Draw the glowing bits to finish the kolam', '#ffe2a0', 2.6, true);
  }

  /** Is p outside the outline of the dots (where only the outer loops run)? */
  private outsideDots(p: P2): boolean {
    const h = this.dotHull;
    if (h.length < 3) return true;
    for (let i = 0; i < h.length; i++) {
      const a = h[i];
      const b = h[(i + 1) % h.length];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return true;
    }
    return false;
  }

  /** Is the player looking at the drawing ground (within ~22° of its centre)? */
  private lookingAtBoard(): boolean {
    if (this.visibilityState.value === VisibilityState.NonImmersive) return true;
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    const eye = new Vector3().setFromMatrixPosition(head.matrixWorld);
    head.getWorldQuaternion(this.tmpQ);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.tmpQ);
    const centre = this.board.localToWorld(new Vector3(0, 0, 0)).sub(eye).normalize();
    return fwd.angleTo(centre) < (22 * Math.PI) / 180;
  }

  private stopDemo(): void {
    this.demoActive = false;
    this.demoWaiting = false;
    this.demoHead.scale.setScalar(1);
    this.demoFade = 0;
    this.demoHead.visible = false;
    this.demo?.clear();
  }

  private updateDemo(delta: number): void {
    if (!this.demo || !this.demoMat) return;

    if (this.demoFade > 0) {
      this.demoFade -= delta;
      this.demoMat.opacity = Math.max(0, (this.demoFade / 1.5) * 0.9);
      if (this.demoFade <= 0) this.stopDemo();
      return;
    }
    if (!this.demoActive) return;

    if (this.demoWaiting) {
      this.demoWait += delta;
      this.demoLooking = this.lookingAtBoard() ? this.demoLooking + delta : 0;
      // the pen waits at the start, gently pulsing, until you look
      this.demoHead.scale.setScalar(1 + 0.35 * Math.sin(this.demoWait * 6));
      if ((this.demoLooking >= 0.4 && this.demoWait >= 0.8) || this.demoWait >= 5) {
        this.demoWaiting = false;
        this.demoHead.scale.setScalar(1);
      }
      return;
    }

    this.demoT += delta;
    const total = this.demoCumLen[this.demoCumLen.length - 1];
    const target = Math.min(total, (this.demoT / this.demoDuration) * total);
    const lineWidth = Math.max(0.0035, this.spacing * 0.09) * 0.8;

    while (this.demoDrawn < this.samples.length - 1 && this.demoCumLen[this.demoDrawn + 1] <= target) {
      const i = this.demoDrawn;
      const a = this.samples[i];
      this.demo.addSegment(a, this.isGap[i] ? a : this.samples[i + 1], lineWidth, 0.0025);
      this.demoDrawn++;
    }
    const head = this.samples[Math.min(this.demoDrawn, this.samples.length - 1)];
    this.demoHead.position.set(head.x, head.y, 0.004);

    if (this.demoT >= this.demoDuration + 0.8) {
      // Done: keep it a moment, then fade away and let the player draw.
      this.demoActive = false;
      this.demoHead.visible = false;
      this.demoFade = 1.5;
      this.drawLabel();
    }
  }

  // ===========================================================================
  // 2D UI (canvas textures)
  // ===========================================================================
  private showCursor(p: Hit, pinching: boolean, ring: Mesh = this.cursor): void {
    ring.visible = true;
    ring.position.set(p.x, p.y, 0.004);
    this.cursorMat.opacity = pinching ? 1 : 0.6;
    ring.scale.setScalar(pinching ? 0.85 : 1); // the ring tightens a little as you pinch
  }

  /** Ask for the title panel to be redrawn (at most ~8 times a second, to keep VR smooth). */
  private drawLabel(): void {
    this.labelDirty = true;
  }

  private renderLabel(): void {
    const ctx = this.label.ctx;
    const level = LEVELS[this.levelIndex];
    const W = this.label.canvas.width;
    const H = this.label.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(36,16,18,0.85)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 36);
    ctx.fill();
    ctx.textBaseline = 'middle';

    if (this.game === 'puzzle') {
      this.drawPuzzleLabel(ctx, W, H);
      return;
    }
    if (this.selecting) {
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Choose a kolam', 40, H / 2 - 18);
      ctx.font = '400 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#c9a28c';
      ctx.fillText(
        this.game === 'draw' ? `★ ${progress.totalStars()} of ${LEVELS.length * 3} stars · finish a kolam to unlock the next` : 'Learn mode · every kolam is open',
        40,
        H / 2 + 34,
      );
      this.label.refresh();
      return;
    }
    if (this.complete) {
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 56px "Segoe UI", system-ui, sans-serif';
      const s = this.stars();
      if (this.mode === 'hard') {
        ctx.fillText(`Beautiful!  ${'★'.repeat(s)}${'☆'.repeat(3 - s)}`, 40, H / 2 - 18);
        ctx.font = '400 30px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#c9a28c';
        ctx.fillText(`${Math.round(this.accuracy() * 100)}% accurate · ${this.timeText()} · dots touched ${this.mistakes}`, 40, H / 2 + 34);
      } else {
        ctx.fillText(`Beautiful!  ${'★'.repeat(s)}${'☆'.repeat(3 - s)}`, 40, H / 2);
      }
    } else {
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(this.daily ? `Today's kolam  ·  ${level.name}` : `${level.name}  ·  ${STAGES[stageOf(this.levelIndex)].name} ${this.levelIndex + 1}/${LEVELS.length}`, 40, H / 2 - 22);
      ctx.font = '400 32px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#c9a28c';
      let hint = level.label;
      if (this.demoActive) hint = 'Watch how it is drawn…';
      else if (this.mode === 'medium' && this.previewTimer > 0) hint = `Remember it! Hiding in ${Math.ceil(this.previewTimer)}…`;
      else if (this.mode === 'medium') hint = `${level.label} · draw it from memory`;
      else if (this.mode === 'hard') hint = `${level.label} · draw the kolam from the notebook`;
      ctx.fillText(hint, 40, H / 2 + 34);
    }

    // Progress ring
    const pct = Math.min(1, this.progress() / MODE_SETTINGS[this.mode].completeAt);
    const rx = W - 90;
    const ry = H / 2;
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(255,226,160,0.2)';
    ctx.beginPath();
    ctx.arc(rx, ry, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffd98a';
    ctx.beginPath();
    ctx.arc(rx, ry, 50, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffe2a0';
    ctx.font = '600 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(pct * 100)}%`, rx, ry + 2);

    if (this.mistakes > 0 && !this.complete && this.mode !== 'hard') {
      ctx.fillStyle = '#ff7a7a';
      ctx.font = '400 28px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`dots touched: ${this.mistakes}`, W - 165, ry + 30);
    }
    ctx.textAlign = 'left';
    this.label.refresh();
  }

  // ===========================================================================
  // Today's kolam
  // ===========================================================================
  private startDaily(): void {
    this.closeSelector(false);
    this.game = 'draw';
    this.mode = 'hard';
    this.daily = true;
    this.loadLevel(dailyLevel(LEVELS.length));
    if (progress.dailyDone()) {
      this.showBanner("Today's kolam is already drawn", `${progress.streak()}-day streak · draw it again for practice`, '#ffd98a', 2.4);
    }
  }

  // ===========================================================================
  // Settings (comfort & accessibility)
  // ===========================================================================
  private static readonly SET_ROWS = ['High contrast', 'Bigger lines & dots', 'Sound', 'Buttons on', 'Ground height', 'Done'] as const;

  private openSettings(): void {
    this.endStroke();
    this.closeSelector(false);
    this.settingsOpen = true;
    this.levelGroup.visible = false;
    this.ink.geometry.setDrawRange(0, 0);
    this.settingsPanel.mesh.visible = true;
    this.drawSettings();
    this.drawButtons();
  }

  private closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.settingsPanel.mesh.visible = false;
    this.levelGroup.visible = true;
    this.ink.geometry.setDrawRange(0, this.ink.vertexCount);
    this.drawButtons();
  }

  private settingsTap(hit: P2): void {
    const [px, py] = this.selectorPx(hit);
    const row = Math.floor((py - 150) / 140);
    const name = KolamSystem.SET_ROWS[row];
    if (!name) return;
    kolamAudio.tap();
    let reload = false;
    switch (name) {
      case 'High contrast':
        settings.highContrast = !settings.highContrast;
        reload = true;
        break;
      case 'Bigger lines & dots':
        settings.bigLines = !settings.bigLines;
        reload = true;
        break;
      case 'Sound':
        settings.sound = !settings.sound;
        kolamAudio.setMuted(!settings.sound);
        break;
      case 'Buttons on':
        settings.leftHanded = !settings.leftHanded;
        this.needsPlacement = true;
        this.placementDelay = 0;
        break;
      case 'Ground height':
        settings.height = Math.max(-3, Math.min(3, settings.height + (px > 512 ? 1 : -1)));
        this.needsPlacement = true;
        this.placementDelay = 0;
        break;
      case 'Done':
        this.closeSettings();
        return;
    }
    saveSettings();
    if (reload) {
      this.loadLevel(this.currentIndex());
      this.openSettings();
    } else this.drawSettings();
  }

  private drawSettings(): void {
    const ctx = this.settingsPanel.ctx;
    const W = 1024;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#1c0b0d';
    ctx.fillRect(0, 0, W, W);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe2a0';
    ctx.font = '700 64px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Comfort & access', 48, 80);
    const values: Record<string, string> = {
      'High contrast': settings.highContrast ? 'On' : 'Off',
      'Bigger lines & dots': settings.bigLines ? 'On' : 'Off',
      Sound: settings.sound ? 'On' : 'Off',
      'Buttons on': settings.leftHanded ? 'Left' : 'Right',
      'Ground height': `–   ${settings.height > 0 ? '+' : ''}${settings.height * 5} cm   +`,
      Done: '',
    };
    KolamSystem.SET_ROWS.forEach((name, i) => {
      const y = 150 + i * 140;
      const on = values[name] === 'On';
      ctx.fillStyle = name === 'Done' ? '#7a3b2a' : 'rgba(60,28,30,0.95)';
      ctx.beginPath();
      ctx.roundRect(40, y + 10, W - 80, 120, 36);
      ctx.fill();
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
      if (name === 'Done') {
        ctx.textAlign = 'center';
        ctx.fillText('Done', W / 2, y + 70);
        ctx.textAlign = 'left';
        return;
      }
      ctx.fillText(name, 80, y + 70);
      ctx.textAlign = 'right';
      ctx.fillStyle = on ? '#7bd389' : '#c9a28c';
      ctx.font = '700 50px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(values[name], W - 80, y + 70);
      ctx.textAlign = 'left';
    });
    this.settingsPanel.refresh();
  }

  // ===========================================================================
  // Levels screen
  // ===========================================================================
  private openSelector(): void {
    this.endStroke();
    this.stopDemo();
    this.selecting = true;
    this.selectStage = stageOf(this.levelIndex);
    this.levelGroup.visible = false;
    this.book.visible = false;
    this.ink.geometry.setDrawRange(0, 0);
    this.selector.mesh.visible = true;
    this.drawSelector();
    this.drawLabel();
    this.drawButtons();
  }

  private closeSelector(redraw: boolean): void {
    if (!this.selecting) return;
    this.selecting = false;
    this.selector.mesh.visible = false;
    this.levelGroup.visible = true;
    this.book.visible = this.mode !== 'easy' && this.game !== 'puzzle';
    this.ink.geometry.setDrawRange(0, this.ink.vertexCount);
    if (redraw) {
      this.drawLabel();
      this.drawButtons();
    }
  }

  /** Canvas pixel of a board point on the levels screen. */
  private selectorPx(p: P2): [number, number] {
    return [((p.x + HALF) / BOARD_SIZE) * 1024, ((HALF - p.y) / BOARD_SIZE) * 1024];
  }

  private static readonly SEL_COLS = 5;
  private static readonly SEL_TOP = 150;
  private static readonly SEL_TILE = 196;

  private selectorTap(hit: P2): void {
    const [px, py] = this.selectorPx(hit);
    // Stage tabs
    if (py < 120) {
      const t = Math.floor(px / (1024 / STAGES.length));
      if (t >= 0 && t < STAGES.length) {
        this.selectStage = t;
        kolamAudio.tap();
        this.drawSelector();
      }
      return;
    }
    const col = Math.floor((px - 22) / KolamSystem.SEL_TILE);
    const row = Math.floor((py - KolamSystem.SEL_TOP) / KolamSystem.SEL_TILE);
    if (col < 0 || col >= KolamSystem.SEL_COLS || row < 0) return;
    const st = STAGES[this.selectStage];
    const level = st.from + row * KolamSystem.SEL_COLS + col;
    if (level > st.to) return;
    if (this.game === 'draw' && !progress.isUnlocked(level)) {
      kolamAudio.bump();
      return;
    }
    kolamAudio.tap();
    this.loadLevel(level);
  }

  private drawSelector(): void {
    const ctx = this.selector.ctx;
    const W = 1024;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#1c0b0d';
    ctx.fillRect(0, 0, W, W);

    // Stage tabs
    const tw = W / STAGES.length;
    STAGES.forEach((st, i) => {
      const on = i === this.selectStage;
      const open = this.game !== 'draw' || progress.isUnlocked(st.from);
      ctx.fillStyle = on ? '#7a3b2a' : '#2e1416';
      ctx.beginPath();
      ctx.roundRect(i * tw + 8, 12, tw - 16, 100, 26);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = '#ffd98a';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = open ? '#ffe2a0' : '#7a6a5a';
      ctx.font = '600 34px "Segoe UI", system-ui, sans-serif';
      ctx.fillText((open ? '' : '🔒 ') + st.name, i * tw + tw / 2, 58);
      ctx.font = '400 24px "Nirmala UI", "Segoe UI", sans-serif';
      ctx.fillStyle = open ? '#c9a28c' : '#6a5a4a';
      ctx.fillText(st.tamil, i * tw + tw / 2, 92);
    });

    // Level tiles
    const st = STAGES[this.selectStage];
    const T = KolamSystem.SEL_TILE;
    for (let l = st.from; l <= st.to; l++) {
      const k = l - st.from;
      const x = 22 + (k % KolamSystem.SEL_COLS) * T;
      const y = KolamSystem.SEL_TOP + Math.floor(k / KolamSystem.SEL_COLS) * T;
      const locked = this.game === 'draw' && !progress.isUnlocked(l);
      const current = l === this.levelIndex;
      const stars = progress.stars(l);
      ctx.fillStyle = locked ? '#241214' : stars > 0 ? '#3d1d1c' : '#331719';
      ctx.beginPath();
      ctx.roundRect(x + 6, y + 6, T - 12, T - 12, 24);
      ctx.fill();
      if (current) {
        ctx.strokeStyle = '#ffd98a';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      if (locked) {
        ctx.fillStyle = '#6a5a4a';
        ctx.font = '400 54px "Segoe UI Emoji", "Segoe UI", sans-serif';
        ctx.fillText('🔒', x + T / 2, y + T / 2 + 6);
        ctx.font = '600 30px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(String(l + 1), x + T / 2, y + T - 30);
        continue;
      }
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '700 58px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(String(l + 1), x + T / 2, y + 78);
      ctx.fillStyle = '#c9a28c';
      ctx.font = '400 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(LEVELS[l].family, x + T / 2, y + 112);
      ctx.font = '400 36px "Segoe UI Symbol", "Segoe UI", sans-serif';
      ctx.fillStyle = '#ffd98a';
      ctx.fillText('★'.repeat(stars) + '☆'.repeat(3 - stars), x + T / 2, y + 158);
    }
    ctx.textAlign = 'left';
    this.selector.refresh();
  }

  // ===========================================================================
  // Big pop-up banner + score panel
  // ===========================================================================
  /**
   * Big banners (a new kolam, success) float over the ground. Small ones —
   * mistakes while you draw — sit just past the far edge, so they never cover
   * the dots you are drawing on.
   */
  private showBanner(title: string, sub: string, color: string, seconds: number, small = false): void {
    this.bannerSmall = small;
    const ctx = this.banner.ctx;
    const W = this.banner.canvas.width;
    const H = this.banner.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(24,10,12,0.92)';
    ctx.beginPath();
    ctx.roundRect(10, 10, W - 20, H - 20, 60);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = '800 96px "Segoe UI", "Segoe UI Symbol", system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - 34, W - 80);
    ctx.fillStyle = '#f3e3cc';
    ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, W / 2, H / 2 + 70, W - 80);
    ctx.textAlign = 'left';
    this.banner.refresh();
    this.bannerTime = 0;
    this.bannerLife = seconds;
    this.banner.mesh.visible = true;
  }

  private updateBanner(delta: number): void {
    if (!this.banner.mesh.visible) return;
    this.bannerTime += delta;
    const t = this.bannerTime;
    // Pop in (overshoot), hold, fade out
    const pop = t < 0.25 ? 0.6 + 0.5 * Math.sin((t / 0.25) * (Math.PI / 2)) * 1.1 : t < 0.35 ? 1.1 - (t - 0.25) : 1;
    const sc = Math.min(1.15, pop) * (this.bannerSmall ? 0.56 : 0.55);
    this.banner.mesh.scale.set(sc, sc, 1);
    // Float just above the drawing ground, between it and your eyes, facing you
    const viewer = this.visibilityState.value !== VisibilityState.NonImmersive ? this.player.head : this.camera;
    viewer.updateWorldMatrix(true, false);
    this.board.updateWorldMatrix(true, false);
    const eye = new Vector3().setFromMatrixPosition(viewer.matrixWorld);
    // Warnings float upright just above the far edge of the ground (inside even
    // the glasses' narrow view); big banners a little lower, over the ground.
    if (this.narrowView && viewer === this.player.head) {
      // Glasses: in the upper part of wherever you are looking (the narrow
      // view can't fit it beside the ground when you turn to your hand).
      const q = new Quaternion();
      viewer.getWorldQuaternion(q);
      const up = GLASSES_BANNER_UP * (Math.PI / 180);
      const want = eye.clone().add(new Vector3(0, Math.sin(up), -Math.cos(up)).applyQuaternion(q).multiplyScalar(GLASSES_BANNER_DIST));
      if (t < delta * 1.5) this.bannerRoot.position.copy(want);
      else this.bannerRoot.position.lerp(want, 1 - Math.exp(-delta * 10));
    } else {
      const centre = (this.bannerSmall ? new Vector3(0, HALF + 0.02, 0.07) : new Vector3(0, HALF * 0.25, 0.09)).applyMatrix4(this.board.matrixWorld);
      this.bannerRoot.position.copy(centre.lerp(eye, 0.3));
    }
    this.bannerRoot.lookAt(eye);
    const mat = this.banner.mesh.material as MeshBasicMaterial;
    const fadeStart = this.bannerLife - 0.4;
    mat.opacity = t > fadeStart ? Math.max(0, 1 - (t - fadeStart) / 0.4) : 1;
    if (t >= this.bannerLife) this.banner.mesh.visible = false;
  }

  /** Score panel: lamps, time, accuracy, dots touched (Draw mode). */
  private drawStatus(): void {
    const show = this.mode === 'hard' && this.game !== 'puzzle' && !this.selecting;
    // The upright score panel is hidden: the same score lies on the ground
    // strip, right where you look while drawing (and it keeps a narrow view clear).
    this.status.mesh.visible = false;
    this.groundStatus.mesh.visible = show;
    if (!show) return;
    const key = `${this.lives}|${Math.floor(this.levelTime)}|${Math.round(this.accuracy() * 100)}|${this.mistakes}|${progress.stars(this.levelIndex)}`;
    if (key === this.statusKey) return;
    // Accuracy changes every frame while drawing; redraw ~5 times a second
    // (but a lost lamp shows at once)
    const now = performance.now();
    if (now - this.statusAt < 200 && this.lives === this.statusLives) return;
    this.statusAt = now;
    this.statusLives = this.lives;
    this.statusKey = key;
    const ctx = this.status.ctx;
    const W = this.status.canvas.width;
    const H = this.status.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(28,11,13,0.94)';
    ctx.beginPath();
    ctx.roundRect(6, 6, W - 12, H - 12, 40);
    ctx.fill();
    ctx.strokeStyle = '#7a3b2a';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c9a28c';
    ctx.font = '600 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('LAMPS', W / 2, 62);
    // Three big lamps
    ctx.save();
    ctx.translate(W / 2 - 130, 150);
    ctx.scale(2.1, 2.1);
    this.drawLamps(ctx, 0, 0);
    ctx.restore();

    const rows: [string, string, string][] = [
      ['TIME', this.timeText(), '#ffe2a0'],
      ['ACCURACY', `${Math.round(this.accuracy() * 100)}%`, this.accuracy() >= 0.88 ? '#7bd389' : this.accuracy() >= 0.7 ? '#ffd98a' : '#ff7a7a'],
      ['DOTS TOUCHED', String(this.mistakes), this.mistakes ? '#ff7a7a' : '#7bd389'],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = 290 + i * 105;
      ctx.fillStyle = '#c9a28c';
      ctx.font = '600 28px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(label, W / 2, y);
      ctx.fillStyle = color;
      ctx.font = '700 58px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(value, W / 2, y + 56);
    });
    const best = progress.stars(this.levelIndex);
    ctx.fillStyle = '#ffd98a';
    ctx.font = '400 34px "Segoe UI Symbol", "Segoe UI", sans-serif';
    ctx.fillText(best ? `best ${'★'.repeat(best)}${'☆'.repeat(3 - best)}` : 'first try', W / 2, H - 36);
    ctx.textAlign = 'left';
    this.status.refresh();

    // The same, as a strip on the ground where your eyes are while drawing
    const g = this.groundStatus.ctx;
    const GW = this.groundStatus.canvas.width;
    const GH = this.groundStatus.canvas.height;
    g.clearRect(0, 0, GW, GH);
    g.fillStyle = 'rgba(28,11,13,0.9)';
    g.beginPath();
    g.roundRect(4, 4, GW - 8, GH - 8, 40);
    g.fill();
    g.save();
    g.translate(60, 62);
    g.scale(1.1, 1.1);
    this.drawLamps(g, 0, 0);
    g.restore();
    g.textBaseline = 'middle';
    g.font = '700 50px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = '#ffe2a0';
    g.fillText(this.timeText(), 290, GH / 2);
    const acc = this.accuracy();
    g.fillStyle = acc >= 0.88 ? '#7bd389' : acc >= 0.7 ? '#ffd98a' : '#ff7a7a';
    g.fillText(`${Math.round(acc * 100)}%`, 480, GH / 2);
    g.fillStyle = this.mistakes ? '#ff7a7a' : '#c9a28c';
    g.font = '600 40px "Segoe UI", system-ui, sans-serif';
    g.fillText(`dots touched ${this.mistakes}`, 660, GH / 2);
    this.groundStatus.refresh();
  }

  /** Three little vilakku lamps: lit = lifelines left. */
  private drawLamps(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const lit = i < this.lives;
      const cx = x + i * 62;
      // bowl
      ctx.fillStyle = lit ? '#d9a62e' : '#5a4a3a';
      ctx.beginPath();
      ctx.ellipse(cx, y + 12, 24, 11, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillRect(cx - 24, y + 8, 48, 5);
      // flame
      if (lit) {
        ctx.fillStyle = '#ffb648';
        ctx.beginPath();
        ctx.moveTo(cx, y - 22);
        ctx.quadraticCurveTo(cx + 12, y - 2, cx, y + 6);
        ctx.quadraticCurveTo(cx - 12, y - 2, cx, y - 22);
        ctx.fill();
        ctx.fillStyle = '#fff1b8';
        ctx.beginPath();
        ctx.ellipse(cx, y - 2, 4, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#5a4a3a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, y + 4);
        ctx.quadraticCurveTo(cx + 6, y - 6, cx - 2, y - 14); // a wisp of smoke
        ctx.stroke();
      }
    }
  }

  private drawPuzzleLabel(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const pz = PUZZLES[this.puzzleIndex];
    if (this.complete) {
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 52px "Segoe UI", system-ui, sans-serif';
      const s = this.stars();
      ctx.fillText(`One line!  ${'★'.repeat(s)}${'☆'.repeat(3 - s)}`, 40, H / 2 - 18);
      ctx.font = '400 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#c9a28c';
      ctx.fillText(`${this.moves} moves · best possible ${pz.par}${this.hints ? ` · ${this.hints} hints` : ''}`, 40, H / 2 + 34);
    } else {
      ctx.fillStyle = '#ffe2a0';
      ctx.font = '600 46px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`Puzzle ${this.puzzleIndex + 1}/${PUZZLES.length}  ·  ${pz.family}`, 40, H / 2 - 22);
      ctx.font = '400 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#c9a28c';
      ctx.fillText(`Pinch the gaps to join all lines into ONE · moves ${this.moves} (best ${pz.par})`, 40, H / 2 + 32);
    }
    // Big line counter on the right
    const rx = W - 90;
    const ry = H / 2;
    ctx.fillStyle = this.lineCount === 1 ? '#7bd389' : '#ffd98a';
    ctx.beginPath();
    ctx.arc(rx, ry, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241012';
    ctx.textAlign = 'center';
    ctx.font = '700 54px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(this.lineCount), rx, ry - 4);
    ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(this.lineCount === 1 ? 'line' : 'lines', rx, ry + 34);
    ctx.textAlign = 'left';
    this.label.refresh();
  }

  private drawButtons(): void {
    const ctx = this.buttons.ctx;
    const W = this.buttons.canvas.width;
    const H = this.buttons.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(28,11,13,0.9)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 44);
    ctx.fill();
    const bh = H / BUTTONS.length;
    const activeName = this.settingsOpen ? 'Settings' : this.selecting ? 'Levels' : this.daily ? 'Today' : this.game === 'learn' ? 'Learn' : this.game === 'draw' ? 'Draw' : '';
    const activeMode = BUTTONS.indexOf(activeName as ButtonName);
    BUTTONS.forEach((name, i) => {
      const y = i * bh + 10;
      const pressed = i === this.pressedButton;
      const selected = i === activeMode;
      const hover = i === this.hoverButton;
      ctx.fillStyle = pressed ? '#ffd98a' : selected ? '#7a3b2a' : hover ? '#5a2a26' : 'rgba(60,28,30,0.95)';
      ctx.beginPath();
      ctx.roundRect(16, y, W - 32, bh - 20, 36);
      ctx.fill();
      if ((selected || hover) && !pressed) {
        ctx.lineWidth = 7;
        ctx.strokeStyle = hover ? '#ffffff' : '#ffd98a';
        ctx.stroke();
      }
      ctx.fillStyle = pressed ? '#241012' : '#ffe2a0';
      ctx.font = '700 58px "Segoe UI", "Segoe UI Symbol", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let text: string = name;
      if (name === 'Show me') text = this.game === 'puzzle' ? '💡 Hint' : '▶ Show me';
      if (name === 'Restart') text = '↺ Restart';
      if (name === 'Rub out') text = '↶ Rub out';
      if (name === 'Next') text = 'Next ›';
      if (name === 'Today') text = progress.dailyDone() ? 'Today ✓' : '✦ Today';
      ctx.fillText(text, W / 2, y + (bh - 20) / 2 + 2, W - 60);
    });
    ctx.textAlign = 'left';
    this.buttons.refresh();
  }


  /** The notebook pages: left = name and dots, right = the finished kolam in ink. */
  private drawCard(level: KolamDesign, curves: P2[][], dots: P2[]): void {
    const paper = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      ctx.fillStyle = '#f6efdc';
      ctx.fillRect(0, 0, W, H);
      // Faint ruled lines, like a school notebook
      ctx.strokeStyle = 'rgba(90,120,170,0.18)';
      ctx.lineWidth = 2;
      for (let y = 90; y < H - 20; y += 38) {
        ctx.beginPath();
        ctx.moveTo(24, y);
        ctx.lineTo(W - 24, y);
        ctx.stroke();
      }
    };

    // ---- Right page: the kolam, drawn in ink with its dots ----
    {
      const ctx = this.card.ctx;
      const W = this.card.canvas.width;
      const H = this.card.canvas.height;
      paper(ctx, W, H);
      ctx.strokeStyle = 'rgba(200,60,60,0.35)'; // margin line
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W - 50, 0);
      ctx.lineTo(W - 50, H);
      ctx.stroke();

      // Fit this kolam (its curves) to the page
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of curves) for (const p of c) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const scale = Math.min((W - 110) / (maxX - minX), (H - 200) / (maxY - minY));
      const ox = W / 2 - 25 - ((minX + maxX) / 2) * scale;
      const oy = H / 2 - 20 + ((minY + maxY) / 2) * scale;
      ctx.strokeStyle = '#3a2a6b'; // ink
      ctx.lineWidth = Math.max(3, Math.min(9, this.spacing * scale * 0.08));
      ctx.lineJoin = 'round';
      for (const c of curves) {
        ctx.beginPath();
        c.forEach((p, i) => {
          const x = ox + p.x * scale;
          const y = oy - p.y * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = '#b3122a'; // kumkum-red pulli, as many notebooks draw them
      for (const d of dots) {
        ctx.beginPath();
        ctx.arc(ox + d.x * scale, oy - d.y * scale, Math.max(4, Math.min(10, this.spacing * scale * 0.075)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#5a4a3a';
      ctx.font = 'italic 500 34px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(level.label, W / 2, H - 36);
      ctx.textAlign = 'left';
      this.card.refresh();
    }

    // ---- Left page: title, kolam name and the dot grid to start from ----
    {
      const ctx = this.leftPage.ctx;
      const W = this.leftPage.canvas.width;
      const H = this.leftPage.canvas.height;
      paper(ctx, W, H);
      ctx.fillStyle = '#7a1f2b';
      ctx.textAlign = 'center';
      ctx.font = '600 40px Georgia, serif';
      ctx.fillText('கோலம்  ·  Kolam', W / 2, 70);
      ctx.fillStyle = '#3a2a6b';
      ctx.font = 'italic 600 46px Georgia, serif';
      ctx.fillText(level.name, W / 2, 150);
      ctx.font = '400 30px Georgia, serif';
      ctx.fillStyle = '#5a4a3a';
      ctx.fillText(`${this.levelIndex + 1} of ${LEVELS.length}`, W / 2, 195);

      // "Step 1: put the dots" — the pulli grid alone
      ctx.font = 'italic 400 28px Georgia, serif';
      ctx.fillText('Step 1 · place the pulli', W / 2, 270);
      const dxs = dots.map((d) => d.x);
      const dys = dots.map((d) => d.y);
      const ext = Math.max(Math.max(...dxs) - Math.min(...dxs), Math.max(...dys) - Math.min(...dys)) || 1;
      const scale = (W * 0.42) / ext;
      const ox = W / 2 - ((Math.min(...dxs) + Math.max(...dxs)) / 2) * scale;
      const oy = 450 + ((Math.min(...dys) + Math.max(...dys)) / 2) * scale;
      ctx.fillStyle = '#b3122a';
      for (const d of dots) {
        ctx.beginPath();
        ctx.arc(ox + d.x * scale, oy - d.y * scale, Math.max(4, Math.min(9, scale * 0.06)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#5a4a3a';
      ctx.font = 'italic 400 28px Georgia, serif';
      ctx.fillText('Step 2 · follow ONE line →', W / 2, 640);
      ctx.font = '400 24px Georgia, serif';
      ctx.fillText('straight through every crossing,', W / 2, 682);
      ctx.fillText('curve round the outer dots,', W / 2, 716);
      ctx.fillText('never touch a dot', W / 2, 750);
      ctx.textAlign = 'left';
      this.leftPage.refresh();
    }
  }

  // ===========================================================================
  // Desktop mouse + keyboard (testing outside XR)
  // ===========================================================================
  private setupMouseAndKeys(): void {
    const canvas = this.renderer.domElement;
    const toNdc = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      toNdc(e);
      this.mouseDown = true;
      this.mousePressed = true;
      kolamAudio.unlock();
    };
    const onMove = (e: PointerEvent) => toNdc(e);
    const onUp = () => {
      this.mouseDown = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'n') this.loadLevel(this.currentIndex() + 1);
      if (k === 'p') this.loadLevel(this.currentIndex() - 1);
      if (k === 'r') this.loadLevel(this.currentIndex());
      if (k === 'h' && this.game === 'puzzle') this.puzzleHint();
      if (k === 'l') this.setGame('learn');
      if (k === 'g') this.setGame('puzzle');
      if (k === '1') this.setMode('easy');
      if (k === '2') this.setMode('medium');
      if (k === '3') this.setMode('hard');
      if (k === 'd') this.startDemo();
      if (k === 'u' || e.key === 'Backspace') this.rubOut();
      if (k === 't') this.startDaily();
      if (k === 'm') kolamAudio.setMuted(!kolamAudio.muted);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    });
  }

  private updateMouse(): void {
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    if (this.drawingWith === null) {
      const b = this.buttonFromRay(this.raycaster.ray.origin, this.raycaster.ray.direction);
      this.setHover(b);
      if (b >= 0) {
        this.cursor.visible = false;
        if (this.mousePressed) {
          this.mousePressed = false;
          this.clickButton(b);
        }
        return;
      }
    }
    this.board.updateWorldMatrix(true, false);
    const hit = this.intersectBoard(this.raycaster.ray.origin, this.raycaster.ray.direction);

    if (hit) this.showCursor(hit, this.mouseDown);
    else this.cursor.visible = false;

    const pressedNow = this.mousePressed;
    this.mousePressed = false;

    if (this.drawingWith === null && pressedNow && hit) {
      this.press('mouse', hit);
    } else if (this.drawingWith === 'mouse') {
      if (!this.mouseDown) this.endStroke(true);
      else if (hit && hit.zone === 'board') this.addPoint(hit);
    }
  }
}
