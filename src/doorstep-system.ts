/**
 * The setting: a Chennai house front at Margazhi dawn.
 *
 * A lime-washed wall with a carved wooden door, a raised threshold step
 * (painted with turmeric and kumkum), a mango-leaf thoranam over the door,
 * two brass lamps with flickering flames, a tulsi pot, and a large finished
 * kolam on the stone floor of the doorstep.
 *
 * Everything is built from simple shapes in code (no downloaded models).
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  Vector2,
} from '@iwsdk/core';
import { progress } from './kolam-progress.js';
import { design, diamondDots, kolamCurves, ringDots, type P2 } from './kolam-patterns.js';

const WALL_Z = -4.2; // the house front
const KOLAM_Z = WALL_Z + 1.9; // the finished kolam on the forecourt (off to the side)
const KOLAM_X = 2.3;
const DOOR_W = 1.1;
const DOOR_H = 2.15;

const std = (color: number, roughness = 0.85, metalness = 0) =>
  new MeshStandardMaterial({ color, roughness, metalness });

export class DoorstepSystem extends createSystem({}) {
  private root = new Group();
  private flames: Mesh[] = [];
  private lights: PointLight[] = [];
  private t = 0;
  // Streak: one agal (clay lamp) on the thinnai for each day in a row, up to 7
  private streakFlames: Object3D[] = [];
  private streakCheck = 0;

  init(): void {
    this.root.name = 'Doorstep';
    this.buildGround();
    this.buildHouseFront();
    this.buildLamps();
    this.buildTulsi();
    this.buildBanana();
    this.buildCoconutTrees();
    this.buildFloorKolam();
    this.buildStreakLamps();
    this.world.createTransformEntity(this.root, { persistent: true });
  }

  update(delta: number): void {
    this.t += delta;
    this.streakCheck -= delta;
    if (this.streakCheck <= 0) {
      this.streakCheck = 1;
      const lit = Math.min(7, progress.streak());
      this.streakFlames.forEach((f, i) => (f.visible = i < lit));
    }
    // Gentle, irregular flicker
    this.flames.forEach((f, i) => {
      const k = 1 + Math.sin(this.t * 13 + i * 2.1) * 0.06 + Math.sin(this.t * 23.7 + i) * 0.04;
      f.scale.set(1, k, 1);
    });
    this.lights.forEach((l, i) => {
      l.intensity = 1.6 + Math.sin(this.t * 11 + i * 1.7) * 0.18 + Math.sin(this.t * 29 + i) * 0.1;
    });
  }

  // ---------------------------------------------------------------------------
  private add(o: Object3D, x = 0, y = 0, z = 0): Object3D {
    o.position.set(x, y, z);
    o.traverse((c) => {
      const m = c as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.root.add(o);
    return o;
  }

  private buildGround(): void {
    // Swept earth forecourt
    const ground = new Mesh(new CircleGeometry(16, 64), std(0x9b8670, 0.95));
    ground.rotation.x = -Math.PI / 2;
    this.add(ground);

    // Smooth, cow-dung-washed patch in front of the house, where kolams are drawn
    const slab = new Mesh(new CircleGeometry(1.25, 48), std(0x6f6a5f, 0.95));
    slab.rotation.x = -Math.PI / 2;
    this.add(slab, KOLAM_X, 0.012, KOLAM_Z);
  }

  /**
   * A traditional Tamil house front: lime-washed wall, carved door with a
   * raised threshold, a thinnai (raised sitting platform) on each side,
   * wooden pillars carrying a sloping tiled verandah roof, and barred windows.
   */
  private buildHouseFront(): void {
    const wallMat = std(0xf1e6d2, 0.95); // lime wash
    const oxide = std(0x8c3b2a, 0.8); // red oxide floor / skirting
    const woodMat = std(0x5a3220, 0.7);
    const darkWood = std(0x3d2114, 0.7);
    const tileMat = std(0xa4472e, 0.9);

    // ---- Main wall (around the doorway) ----
    const wallW = 8;
    const wallH = 3.3;
    const sideW = (wallW - DOOR_W - 0.3) / 2;
    for (const s of [-1, 1]) {
      this.add(new Mesh(new BoxGeometry(sideW, wallH, 0.3), wallMat), s * (DOOR_W / 2 + 0.15 + sideW / 2), wallH / 2, WALL_Z);
    }
    this.add(new Mesh(new BoxGeometry(DOOR_W + 0.3, wallH - DOOR_H, 0.3), wallMat), 0, DOOR_H + (wallH - DOOR_H) / 2, WALL_Z);

    // ---- Door frame and carved door ----
    const frameT = 0.14;
    for (const s of [-1, 1]) {
      this.add(new Mesh(new BoxGeometry(frameT, DOOR_H + frameT, 0.34), woodMat), s * (DOOR_W / 2 + frameT / 2), (DOOR_H + frameT) / 2, WALL_Z);
    }
    this.add(new Mesh(new BoxGeometry(DOOR_W + frameT * 2, frameT, 0.34), woodMat), 0, DOOR_H + frameT / 2, WALL_Z);
    for (const s of [-1, 1]) {
      const leaf = new Group();
      leaf.add(new Mesh(new BoxGeometry(DOOR_W / 2 - 0.02, DOOR_H - 0.02, 0.06), darkWood));
      for (let r = 0; r < 3; r++) {
        const panel = new Mesh(new BoxGeometry(DOOR_W / 2 - 0.16, 0.48, 0.02), woodMat);
        panel.position.set(0, -0.62 + r * 0.62, 0.04);
        leaf.add(panel);
        for (const dx of [-0.16, 0.16])
          for (const dy of [-0.18, 0.18]) {
            const stud = new Mesh(new SphereGeometry(0.018, 10, 8), std(0xc9a14a, 0.35, 0.9));
            stud.position.set(dx, -0.62 + r * 0.62 + dy, 0.055);
            leaf.add(stud);
          }
      }
      this.add(leaf, s * (DOOR_W / 4), DOOR_H / 2 + 0.01, WALL_Z + 0.06);
    }

    // ---- Raised threshold step: turmeric yellow with kumkum dots ----
    this.add(new Mesh(new BoxGeometry(DOOR_W + 0.3, 0.16, 0.5), std(0xd9a62e, 0.8)), 0, 0.08, WALL_Z + 0.4);
    for (let i = -2; i <= 2; i++) {
      const dot = new Mesh(new CircleGeometry(0.03, 16), std(0xb3122a, 0.6));
      dot.rotation.x = -Math.PI / 2;
      this.add(dot, i * 0.2, 0.161, WALL_Z + 0.42);
    }

    // ---- Thinnai: raised platforms either side of the door ----
    const thinnaiH = 0.5;
    const thinnaiDepth = 1.0;
    const thinnaiW = wallW / 2 - DOOR_W / 2 - 0.45;
    for (const s of [-1, 1]) {
      const x = s * (DOOR_W / 2 + 0.45 + thinnaiW / 2);
      this.add(new Mesh(new BoxGeometry(thinnaiW, thinnaiH, thinnaiDepth), wallMat), x, thinnaiH / 2, WALL_Z + 0.15 + thinnaiDepth / 2);
      // Polished red oxide top and a skirting band
      this.add(new Mesh(new BoxGeometry(thinnaiW + 0.04, 0.04, thinnaiDepth + 0.04), oxide), x, thinnaiH + 0.02, WALL_Z + 0.15 + thinnaiDepth / 2);
      this.add(new Mesh(new BoxGeometry(thinnaiW + 0.01, 0.12, thinnaiDepth + 0.01), oxide), x, 0.06, WALL_Z + 0.15 + thinnaiDepth / 2);
      // A rolled mat on one thinnai, a brass pot on the other
      if (s < 0) {
        const mat = new Mesh(new CylinderGeometry(0.07, 0.07, 0.9, 16), std(0xc9a76b, 0.9));
        mat.rotation.z = Math.PI / 2;
        this.add(mat, x + 0.2, thinnaiH + 0.11, WALL_Z + 0.45);
      } else {
        // Brass kudam (water pot)
        const kudam = new Mesh(
          new LatheGeometry(
            [[0, 0], [0.07, 0], [0.13, 0.06], [0.15, 0.13], [0.12, 0.2], [0.06, 0.25], [0.055, 0.29], [0.085, 0.31], [0, 0.31]].map(
              ([a, b]) => new Vector2(a, b),
            ),
            24,
          ),
          std(0xc9a14a, 0.3, 0.9),
        );
        this.add(kudam, x - 0.3, thinnaiH + 0.04, WALL_Z + 0.45);
      }
    }

    // ---- Barred windows above each thinnai ----
    for (const s of [-1, 1]) {
      const x = s * (DOOR_W / 2 + 0.45 + thinnaiW / 2);
      const win = new Group();
      win.add(new Mesh(new BoxGeometry(0.95, 0.85, 0.05), std(0x24140d, 0.9))); // dark inside
      const frame = [
        [0, 0.45, 1.05, 0.08], [0, -0.45, 1.05, 0.08], [-0.5, 0, 0.08, 0.98], [0.5, 0, 0.08, 0.98],
      ];
      for (const [fx, fy, fw, fh] of frame) {
        const f = new Mesh(new BoxGeometry(fw, fh, 0.1), woodMat);
        f.position.set(fx, fy, 0.03);
        win.add(f);
      }
      for (let i = -3; i <= 3; i++) {
        const bar = new Mesh(new CylinderGeometry(0.012, 0.012, 0.85, 8), std(0x3a3a3a, 0.5, 0.7));
        bar.position.set(i * 0.12, 0, 0.04);
        win.add(bar);
      }
      // Half-open wooden shutters
      for (const side of [-1, 1]) {
        const sh = new Mesh(new BoxGeometry(0.46, 0.85, 0.03), std(0x2f6f6a, 0.8));
        sh.position.set(side * 0.72, 0, 0.12);
        sh.rotation.y = side * 0.6;
        win.add(sh);
      }
      this.add(win, x, 1.45, WALL_Z + 0.17);
    }

    // ---- Pillars and sloping tiled verandah roof ----
    const pillarZ = WALL_Z + 1.35;
    const pillarH = 2.45;
    for (const px of [-3.6, -1.3, 1.3, 3.6]) {
      const pillar = new Group();
      pillar.add(new Mesh(new BoxGeometry(0.2, 0.18, 0.2), std(0x6f5a48, 0.9))); // stone base
      const shaft = new Mesh(new CylinderGeometry(0.075, 0.085, pillarH - 0.3, 12), woodMat);
      shaft.position.y = (pillarH - 0.3) / 2 + 0.09;
      pillar.add(shaft);
      const cap = new Mesh(new BoxGeometry(0.24, 0.12, 0.24), woodMat);
      cap.position.y = pillarH - 0.15;
      pillar.add(cap);
      // Potikai: the carved bracket that spreads out under the beam
      const potikai = new Mesh(new BoxGeometry(0.62, 0.09, 0.2), woodMat);
      potikai.position.y = pillarH - 0.05;
      pillar.add(potikai);
      for (const sx of [-1, 1]) {
        const drop = new Mesh(new SphereGeometry(0.045, 10, 8), woodMat); // lotus-bud ends
        drop.scale.set(1, 1.3, 1);
        drop.position.set(sx * 0.31, pillarH - 0.12, 0);
        pillar.add(drop);
      }
      // Carved bands on the shaft
      for (const by of [0.45, pillarH - 0.45]) {
        const band = new Mesh(new CylinderGeometry(0.1, 0.1, 0.07, 12), woodMat);
        band.position.y = by;
        pillar.add(band);
      }
      this.add(pillar, px, 0.09, pillarZ);
    }
    // Beam along the pillar tops
    this.add(new Mesh(new BoxGeometry(wallW + 0.2, 0.16, 0.2), woodMat), 0, pillarH, pillarZ);

    // Roof slope: from the wall top down to just beyond the pillars
    const roofTopY = wallH - 0.05;
    const roofLowY = pillarH + 0.1;
    const roofRun = pillarZ + 0.45 - WALL_Z;
    const roofLen = Math.hypot(roofRun, roofTopY - roofLowY);
    const roof = new Group();
    roof.add(new Mesh(new BoxGeometry(wallW + 0.8, 0.07, roofLen), tileMat));
    // Tile ridges for texture
    for (let i = 0; i < 26; i++) {
      const ridge = new Mesh(new CylinderGeometry(0.035, 0.035, roofLen, 6), std(0x8f3a24, 0.9));
      ridge.rotation.x = Math.PI / 2;
      ridge.position.set(-(wallW + 0.6) / 2 + i * ((wallW + 0.6) / 25), 0.05, 0);
      roof.add(ridge);
    }
    roof.rotation.x = Math.atan2(roofTopY - roofLowY, roofRun);
    this.add(roof, 0, (roofTopY + roofLowY) / 2 + 0.06, WALL_Z + roofRun / 2);

    // Main roof: country tiles sloping up from the wall top to a ridge
    const ridgeY = wallH + 1.0;
    const ridgeZ = WALL_Z - 2.2;
    const mainRun = WALL_Z - ridgeZ + 0.25;
    const mainLen = Math.hypot(mainRun, ridgeY - wallH);
    const mainRoof = this.tileRoof(wallW + 0.6, mainLen, tileMat);
    mainRoof.rotation.x = Math.atan2(ridgeY - wallH, mainRun); // rises towards the back, to the ridge
    this.add(mainRoof, 0, (ridgeY + wallH) / 2 + 0.03, WALL_Z + 0.25 - mainRun / 2);
    const ridgeCap = new Mesh(new CylinderGeometry(0.09, 0.09, wallW + 0.7, 10), std(0x7a2e1c, 0.9));
    ridgeCap.rotation.z = Math.PI / 2;
    this.add(ridgeCap, 0, ridgeY + 0.05, ridgeZ);
    // A strip of wall where the two roofs meet
    this.add(new Mesh(new BoxGeometry(wallW, 0.12, 0.3), oxide), 0, wallH - 0.02, WALL_Z);

    // Kaavi stripes: red-ochre and white bands on the thinnai fronts
    const kaavi = std(0xb4462a, 0.85);
    for (const s of [-1, 1]) {
      const x0 = s * (DOOR_W / 2 + 0.45);
      const x1 = s * (wallW / 2);
      const n = Math.floor(Math.abs(x1 - x0) / 0.24);
      for (let i = 0; i < n; i++) {
        const x = x0 + s * (0.12 + i * 0.24);
        if (i % 2 === 0) this.add(new Mesh(new BoxGeometry(0.12, 0.3, 0.01), kaavi), x, 0.3, WALL_Z + 0.15 + 1.0 + 0.006);
      }
    }

    // ---- Mango-leaf thoranam above the door ----
    const strings = 11;
    for (let i = 0; i < strings; i++) {
      const u = i / (strings - 1);
      const x = (u - 0.5) * (DOOR_W + 0.25);
      const y = DOOR_H + 0.05 - Math.sin(u * Math.PI) * 0.06;
      const leaf = new Mesh(new ConeGeometry(0.035, 0.22, 4), std(i % 2 ? 0x3f7d2c : 0x5c9a36, 0.8));
      leaf.rotation.z = Math.PI;
      leaf.scale.set(1, 1, 0.3);
      this.add(leaf, x, y - 0.12, WALL_Z + 0.2);
      if (i % 3 === 1) this.add(new Mesh(new SphereGeometry(0.03, 10, 8), std(0xf28c1c, 0.7)), x, y - 0.02, WALL_Z + 0.21);
    }
    const cord = new Mesh(new CylinderGeometry(0.006, 0.006, DOOR_W + 0.3, 6), std(0xe8d7a0, 0.9));
    cord.rotation.z = Math.PI / 2;
    this.add(cord, 0, DOOR_H + 0.03, WALL_Z + 0.2);
  }

  /** A sloped sheet of half-round country tiles (naattu odu). */
  private tileRoof(width: number, len: number, mat: MeshStandardMaterial): Group {
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(width, 0.07, len), mat));
    const n = Math.round(width / 0.3);
    const ridgeMat = std(0x8f3a24, 0.9);
    for (let i = 0; i <= n; i++) {
      const r = new Mesh(new CylinderGeometry(0.04, 0.04, len, 6), ridgeMat);
      r.rotation.x = Math.PI / 2;
      r.position.set(-width / 2 + (i * width) / n, 0.05, 0);
      g.add(r);
    }
    return g;
  }

  /** Vaazhai maram — banana plants tied at the entrance for festivals. */
  private buildBanana(): void {
    const trunkMat = std(0x8a9a4a, 0.85);
    const leafMat = new MeshStandardMaterial({ color: 0x4f9a33, roughness: 0.75, side: DoubleSide });
    const leafMat2 = new MeshStandardMaterial({ color: 0x6fb540, roughness: 0.75, side: DoubleSide });
    for (const s of [-1, 1]) {
      const plant = new Group();
      const trunk = new Mesh(new CylinderGeometry(0.06, 0.085, 2.0, 10), trunkMat);
      trunk.position.y = 1.0;
      plant.add(trunk);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + s;
        const leaf = new Mesh(new SphereGeometry(0.5, 12, 6), i % 2 ? leafMat : leafMat2);
        leaf.scale.set(0.24, 0.02, 1.0);
        const pivot = new Group();
        pivot.position.y = 1.95 + (i % 3) * 0.06;
        pivot.rotation.y = a;
        leaf.position.z = 0.45;
        leaf.rotation.x = 0.35 + (i % 3) * 0.15; // arching down
        pivot.add(leaf);
        plant.add(pivot);
      }
      // A hanging bunch of bananas
      const bunch = new Mesh(new CylinderGeometry(0.08, 0.04, 0.32, 10), std(0x9fb03c, 0.8));
      bunch.position.set(0.1 * s, 1.6, 0.08);
      plant.add(bunch);
      this.add(plant, s * 1.48, 0, WALL_Z + 1.35);
    }
  }

  /** Coconut palms around the house. */
  private buildCoconutTrees(): void {
    const trunkMat = std(0x7b6450, 0.95);
    const frondMat = new MeshStandardMaterial({ color: 0x3f7d2c, roughness: 0.8, side: DoubleSide });
    const spots: [number, number, number, number][] = [
      // x, z, height, lean
      [-5.6, WALL_Z - 1.2, 7.0, 0.12],
      [6.2, WALL_Z - 2.4, 8.0, -0.1],
      [-14.2, WALL_Z + 2.2, 6.5, 0.18],
      [14.4, WALL_Z + 1.8, 7.4, -0.15],
    ];
    for (const [x, z, h, lean] of spots) {
      const tree = new Group();
      const segs = 7;
      let px = 0;
      let py = 0;
      for (let i = 0; i < segs; i++) {
        const segH = h / segs;
        const seg = new Mesh(new CylinderGeometry(0.13 - i * 0.008, 0.15 - i * 0.008, segH + 0.02, 8), trunkMat);
        const ang = lean * (i / segs) * 1.6;
        seg.rotation.z = -ang;
        seg.position.set(px + Math.sin(ang) * (segH / 2), py + Math.cos(ang) * (segH / 2), 0);
        tree.add(seg);
        px += Math.sin(ang) * segH;
        py += Math.cos(ang) * segH;
      }
      for (let i = 0; i < 10; i++) {
        const pivot = new Group();
        pivot.position.set(px, py, 0);
        pivot.rotation.y = (i / 10) * Math.PI * 2;
        const frond = new Mesh(new SphereGeometry(1, 12, 6), frondMat);
        frond.scale.set(0.22, 0.02, 1.25);
        frond.position.z = 1.1;
        frond.rotation.x = 0.55 + (i % 2) * 0.2;
        pivot.add(frond);
        tree.add(pivot);
      }
      for (let i = 0; i < 4; i++) {
        const nut = new Mesh(new SphereGeometry(0.12, 10, 8), std(0x6b7a2a, 0.8));
        nut.position.set(px + Math.cos(i * 1.6) * 0.18, py - 0.2, Math.sin(i * 1.6) * 0.18);
        tree.add(nut);
      }
      this.add(tree, x, 0, z);
    }
  }

  /** Neighbouring houses, so it feels like an agraharam street. */
  private buildNeighbours(): void {
    const looks: [number, number][] = [
      [-9.4, 0xf3e3a9], // pale turmeric yellow
      [9.4, 0xc9dce6], // pale sky blue
    ];
    for (const [cx, color] of looks) {
      const wallMat = std(color, 0.95);
      const kaavi = std(0xb4462a, 0.85);
      const wood = std(0x5a3220, 0.7);
      const w = 8.2;
      const h = 3.1;
      const z = WALL_Z + 0.2;
      this.add(new Mesh(new BoxGeometry(w, h, 0.3), wallMat), cx, h / 2, z);
      // Door and windows
      this.add(new Mesh(new BoxGeometry(1.0, 2.0, 0.06), std(0x3d2114, 0.7)), cx, 1.0, z + 0.17);
      this.add(new Mesh(new BoxGeometry(1.0, 0.14, 0.4), std(0xd9a62e, 0.8)), cx, 0.07, z + 0.35);
      for (const sx of [-1, 1]) {
        this.add(new Mesh(new BoxGeometry(0.85, 0.8, 0.06), std(0x24140d, 0.9)), cx + sx * 2.3, 1.45, z + 0.17);
        // Thinnai with kaavi stripes
        const tx = cx + sx * 2.3;
        this.add(new Mesh(new BoxGeometry(2.8, 0.48, 1.0), wallMat), tx, 0.24, z + 0.65);
        this.add(new Mesh(new BoxGeometry(2.84, 0.04, 1.04), std(0x8c3b2a, 0.8)), tx, 0.5, z + 0.65);
        for (let i = 0; i < 6; i++) {
          this.add(new Mesh(new BoxGeometry(0.12, 0.28, 0.01), kaavi), tx - 1.25 + i * 0.5, 0.26, z + 1.16);
        }
      }
      // Pillars + verandah roof
      for (const px of [-3.7, -1.2, 1.2, 3.7]) {
        this.add(new Mesh(new CylinderGeometry(0.07, 0.08, 2.3, 10), wood), cx + px, 1.15, z + 1.3);
      }
      this.add(new Mesh(new BoxGeometry(w + 0.2, 0.15, 0.2), wood), cx, 2.35, z + 1.3);
      const run = 1.75;
      const roof = this.tileRoof(w + 0.6, Math.hypot(run, 0.6), std(0xa4472e, 0.9));
      roof.rotation.x = Math.atan2(0.6, run);
      this.add(roof, cx, 2.75, z + run / 2);
      const main = this.tileRoof(w + 0.6, 2.5, std(0x9c4229, 0.9));
      main.rotation.x = 0.55;
      this.add(main, cx, h + 0.6, z - 1.0);
      // Their own little kolam
      this.add(this.smallKolam(), cx, 0.015, z + 2.6);
    }
  }

  /** A small finished woven kolam lying on the ground. */
  private smallKolam(): Group {
    const g = new Group();
    const d = design('n', '', diamondDots(2));
    const spacing = 0.13;
    const width = 0.016;
    const positions: number[] = [];
    for (const curve of kolamCurves(d, 8)) {
      for (let i = 0; i < curve.length; i++) {
        const a = curve[i];
        const b = curve[(i + 1) % curve.length];
        const ax = a.x * spacing, ay = a.y * spacing, bx = b.x * spacing, by = b.y * spacing;
        const dx = bx - ax, dy = by - ay;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * width, ny = (dx / l) * width;
        positions.push(ax + nx, 0, -(ay + ny), ax - nx, 0, -(ay - ny), bx + nx, 0, -(by + ny));
        positions.push(ax - nx, 0, -(ay - ny), bx - nx, 0, -(by - ny), bx + nx, 0, -(by + ny));
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    g.add(new Mesh(geo, new MeshStandardMaterial({ color: 0xfaf6ee, roughness: 1, side: DoubleSide })));
    return g;
  }

  /** Seven agal lamps along the right thinnai: one lights up per day of your streak. */
  private buildStreakLamps(): void {
    const clay = std(0xa0522d, 0.9);
    const thinnaiTop = 0.54;
    const z = WALL_Z + 0.15 + 1.0 - 0.08;
    for (let i = 0; i < 7; i++) {
      const x = 1.35 + i * 0.36;
      const bowl = new Mesh(new SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), clay);
      bowl.rotation.x = Math.PI; // open side up
      bowl.scale.set(1, 0.55, 1);
      this.add(bowl, x, thinnaiTop + 0.04, z);
      // Flame with a soft glow (one group, so it lights up together)
      const fire = new Group();
      const flame = new Mesh(new ConeGeometry(0.022, 0.09, 10), new MeshBasicMaterial({ color: 0xffb648 }));
      fire.add(flame);
      const glow = new Mesh(
        new SphereGeometry(0.07, 12, 8),
        new MeshBasicMaterial({ color: 0xffc66b, transparent: true, opacity: 0.3, depthWrite: false }),
      );
      fire.add(glow);
      fire.position.set(x + 0.045, thinnaiTop + 0.1, z);
      fire.visible = false;
      this.root.add(fire);
      this.flames.push(flame);
      this.streakFlames.push(fire);
    }
  }

  private buildLamps(): void {
    const brass = std(0xc9a14a, 0.32, 0.95);
    // Kuthu vilakku silhouette, turned on a lathe
    const profile = [
      [0.0, 0.0], [0.14, 0.0], [0.15, 0.02], [0.06, 0.05], [0.035, 0.1], [0.03, 0.42],
      [0.05, 0.45], [0.025, 0.48], [0.022, 0.6], [0.12, 0.64], [0.13, 0.67], [0.02, 0.68], [0.0, 0.68],
    ].map(([x, y]) => new Vector2(x, y));
    const geo = new LatheGeometry(profile, 32);

    for (const s of [-1, 1]) {
      const lamp = new Group();
      lamp.add(new Mesh(geo, brass));
      // Finial
      const top = new Mesh(new ConeGeometry(0.035, 0.12, 12), brass);
      top.position.y = 0.76;
      lamp.add(top);
      // Five flames round the oil bowl (we show three facing the player)
      for (const a of [-0.5, 0, 0.5]) {
        const flame = new Mesh(
          new ConeGeometry(0.014, 0.06, 10),
          new MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.95 }),
        );
        flame.position.set(Math.sin(a) * 0.11, 0.71, Math.cos(a) * 0.11);
        lamp.add(flame);
        this.flames.push(flame);
        const glow = new Mesh(
          new SphereGeometry(0.03, 10, 8),
          new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.25, depthWrite: false }),
        );
        glow.position.copy(flame.position);
        lamp.add(glow);
      }
      const light = new PointLight(0xffb052, 1.6, 3.5, 2);
      light.position.set(0, 0.8, 0.1);
      lamp.add(light);
      this.lights.push(light);
      this.add(lamp, s * (DOOR_W / 2 + 0.25), 0.0, WALL_Z + 0.85);
    }
  }

  /** Tulasi maadam: a lime-washed brindavan with a lamp niche and tulsi on top. */
  private buildTulsi(): void {
    const lime = std(0xf4ecdc, 0.95);
    const kaavi = std(0xb4462a, 0.85);
    const m = new Group();
    const step = new Mesh(new BoxGeometry(0.75, 0.14, 0.75), lime);
    step.position.y = 0.07;
    m.add(step);
    const shaft = new Mesh(new BoxGeometry(0.46, 0.7, 0.46), lime);
    shaft.position.y = 0.49;
    m.add(shaft);
    for (const y of [0.17, 0.82]) {
      const band = new Mesh(new BoxGeometry(0.5, 0.06, 0.5), kaavi);
      band.position.y = y;
      m.add(band);
    }
    // Lamp niche on the front, with a little flame
    const niche = new Mesh(new BoxGeometry(0.16, 0.22, 0.02), std(0x2a160e, 0.9));
    niche.position.set(0, 0.48, 0.235);
    m.add(niche);
    const flame = new Mesh(new ConeGeometry(0.012, 0.05, 8), new MeshBasicMaterial({ color: 0xffb648 }));
    flame.position.set(0, 0.45, 0.245);
    m.add(flame);
    this.flames.push(flame);
    // Planter on top with four little corner horns
    const planter = new Mesh(new BoxGeometry(0.56, 0.2, 0.56), lime);
    planter.position.y = 0.95;
    m.add(planter);
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const horn = new Mesh(new ConeGeometry(0.05, 0.16, 8), kaavi);
      horn.position.set(cx * 0.25, 1.13, cz * 0.25);
      m.add(horn);
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = 0.04 + (i % 3) * 0.05;
      const leaf = new Mesh(new SphereGeometry(0.055, 8, 6), std(i % 2 ? 0x2f6b2a : 0x3e8a35, 0.8));
      leaf.scale.set(1, 0.7, 1);
      leaf.position.set(Math.cos(a) * r, 1.12 + (i % 5) * 0.06, Math.sin(a) * r);
      m.add(leaf);
    }
    this.add(m, -2.4, 0, WALL_Z + 2.6);
  }

  /** A large finished kolam on the doorstep floor — what the player is learning. */
  private buildFloorKolam(): void {
    const dots = diamondDots(3);
    const odd = (v: number) => Math.abs(v) % 2 === 1;
    const circled = dots.filter((p) => odd(p.x) && odd(p.y));
    const d = design('doorstep', '', dots, ringDots(circled));
    const spacing = 0.15;
    const width = 0.018;
    const positions: number[] = [];
    const push = (a: P2, b: P2) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * width;
      const ny = (dx / len) * width;
      const ex = (dx / len) * width;
      const ey = (dy / len) * width;
      const q = [
        [a.x - ex + nx, a.y - ey + ny], [a.x - ex - nx, a.y - ey - ny], [b.x + ex + nx, b.y + ey + ny],
        [a.x - ex - nx, a.y - ey - ny], [b.x + ex - nx, b.y + ey - ny], [b.x + ex + nx, b.y + ey + ny],
      ];
      for (const [x, y] of q) positions.push(x, 0, -y);
    };
    for (const curve of kolamCurves(d, 10)) {
      const pts = curve.map((p) => ({ x: p.x * spacing, y: p.y * spacing }));
      for (let i = 0; i < pts.length; i++) push(pts[i], pts[(i + 1) % pts.length]);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    const kolam = new Mesh(geo, new MeshStandardMaterial({ color: 0xfaf6ee, roughness: 1, side: DoubleSide }));
    kolam.receiveShadow = true;
    kolam.position.set(KOLAM_X, 0.016, KOLAM_Z);
    this.root.add(kolam);

    for (const p of dots) {
      const dot = new Mesh(new CircleGeometry(0.012, 10), new MeshBasicMaterial({ color: new Color(0xffffff) }));
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(KOLAM_X + p.x * spacing, 0.017, KOLAM_Z - p.y * spacing);
      this.root.add(dot);
    }

    // A few marigold flowers placed round it, as done for festivals
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const f = new Mesh(new SphereGeometry(0.035, 10, 8), std(i % 2 ? 0xf28c1c : 0xffc21a, 0.7));
      f.scale.set(1, 0.5, 1);
      this.add(f, KOLAM_X + Math.cos(a) * 0.72, 0.03, KOLAM_Z + Math.sin(a) * 0.72);
    }
  }
}
