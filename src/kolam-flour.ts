/**
 * Rice flour falling from the fingertips while you draw — the way a kolam is
 * really made: a pinch of flour trickling down onto the ground.
 *
 * A pool of tiny points in the drawing surface's local space (+Z = up off the
 * ground). Grains drop straight down and STAY where they land, like real
 * flour, until the kolam is cleared.
 */
import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from '@iwsdk/core';

const POOL = 5000; // oldest grains are recycled first
const GRAVITY = 0.9; // m/s², gentle (flour drifts)

export class FlourParticles {
  readonly points: Points;
  private pos = new Float32Array(POOL * 3);
  private vel = new Float32Array(POOL * 3);
  private life = new Float32Array(POOL); // < 0 = free
  private next = 0;

  constructor() {
    const geo = new BufferGeometry();
    for (let i = 0; i < POOL; i++) {
      this.pos[i * 3 + 2] = -10; // hidden below the ground
      this.life[i] = -1;
    }
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        color: 0xfffbf0,
        size: 0.0022,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** Release `count` grains from (x, y) at height `h` above the ground. */
  emit(x: number, y: number, h: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const k = i * 3;
      // A tiny spread around the fingertip, then straight down — no drifting
      this.pos[k] = x + (Math.random() - 0.5) * 0.0025;
      this.pos[k + 1] = y + (Math.random() - 0.5) * 0.0025;
      this.pos[k + 2] = Math.min(0.03, Math.max(0.006, h)) + Math.random() * 0.004;
      this.vel[k] = 0;
      this.vel[k + 1] = 0;
      this.vel[k + 2] = -0.08 - Math.random() * 0.04;
      this.life[i] = 0;
    }
  }

  /** Wipe the most recently dropped `n` grains (rubbing out a line). */
  eraseLast(n: number): void {
    for (let c = 0; c < Math.min(n, POOL); c++) {
      this.next = (this.next - 1 + POOL) % POOL;
      this.life[this.next] = -1;
      this.pos[this.next * 3 + 2] = -10;
    }
    (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }

  update(delta: number): void {
    let any = false;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] < 0) continue;
      any = true;
      const k = i * 3;
      if (this.pos[k + 2] > 0.0035) {
        // Falling
        this.vel[k + 2] -= GRAVITY * delta;
        this.pos[k] += this.vel[k] * delta;
        this.pos[k + 1] += this.vel[k + 1] * delta;
        this.pos[k + 2] = Math.max(0.0035, this.pos[k + 2] + this.vel[k + 2] * delta);
      }
      // Once on the ground it stays put
    }
    if (any) (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < POOL; i++) {
      this.life[i] = -1;
      this.pos[i * 3 + 2] = -10;
    }
    (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }
}
