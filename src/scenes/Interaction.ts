import { Vector2 } from 'three';

/**
 * Tracks the cursor on screen with soft, damped motion.
 * `strength` rises while the pointer moves and settles back to calm.
 */
export class Interaction {
  /** Smoothed cursor, normalized device coordinates. */
  readonly ndc = new Vector2(9, 9);
  readonly velocity = new Vector2();
  strength = 0;

  private target = new Vector2(9, 9);
  private energy = 0;
  private abort = new AbortController();

  constructor() {
    const { signal } = this.abort;
    window.addEventListener(
      'pointermove',
      (e) => {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = 1 - (e.clientY / window.innerHeight) * 2;
        // Jump rather than sweep in from far away.
        if (this.target.x > 2) this.ndc.set(x, y);
        this.target.set(x, y);
        this.energy = Math.min(1, this.energy + 0.12);
      },
      { passive: true, signal },
    );
    document.documentElement.addEventListener('pointerleave', () => (this.energy = 0), { signal });
  }

  update(dt: number) {
    const ease = 1 - Math.exp(-dt * 6);
    const px = this.ndc.x;
    const py = this.ndc.y;
    this.ndc.lerp(this.target, ease);
    if (dt > 0) {
      this.velocity.lerp(new Vector2((this.ndc.x - px) / dt, (this.ndc.y - py) / dt).clampLength(0, 3), ease);
    }
    this.energy *= Math.exp(-dt * 1.4);
    this.strength += (this.energy - this.strength) * ease;
  }

  dispose() {
    this.abort.abort();
  }
}
