/**
 * Where you are facing. One heading drives the camera, the listener, and the
 * compass in the sound toggle, so sight and sound always agree.
 *
 * yaw = tour + free + compass + look
 *   tour     scrolling turns you to face each section's station
 *   free     drag / swipe / arrow keys, with momentum; stays where you leave it
 *   compass  a phone's own heading, once permission is granted
 *   look     a small nudge from where the mouse rests
 */
import { STATIONS, TAU, stationAngle } from './world';
import { isInteractive } from './dom';

const MAX_PITCH = (25 * Math.PI) / 180;
const TEXT = 'p, h1, h2, h3, li, span, strong, em, time, label';

type Side = 'center' | 'right';

class Heading {
  yaw = 0;
  pitch = 0;
  /** Turning speed, rad/s, smoothed. */
  omega = 0;
  /** 0 while moving, rising to 1 after a calm spell. */
  stillness = 0;
  station = 0;
  side: Side = 'center';
  /** How far the camera looks away from a station so it sits beside the text. */
  sideAngle = 0;

  private tour = 0;
  private tourBase = 0;
  private tourVel = 0;
  private tourReady = false;
  private free = 0;
  private freeVel = 0;
  private freePitch = 0;
  private compass = 0;
  private compassPitch = 0;
  private heading0: number | null = null;
  private beta0: number | null = null;
  private look = { x: 0, y: 0, tx: 0, ty: 0 };
  private last = performance.now();
  private prevYaw = 0;
  private drag: { id: number; x: number; y: number; t: number; touch: boolean; text: boolean; moved: boolean; active: boolean; swiped: boolean } | null = null;
  private compassEls: HTMLElement[] = [];
  private shownYaw = NaN;

  constructor() {
    this.listen();
    this.compassEls = [...document.querySelectorAll<HTMLElement>('[data-compass]')];
  }

  /** Advance the heading. Safe to call from several loops; each call integrates the time since the last. */
  update() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (dt <= 0) return this;

    // The tour: a critically damped spring, so turns start and end softly.
    const k = 2.2;
    const target = this.tourBase - (this.side === 'right' ? this.sideAngle : 0);
    this.tourVel += (k * (target - this.tour) - 2 * Math.sqrt(k) * this.tourVel) * dt;
    this.tour += this.tourVel * dt;

    // Free look: momentum after a drag or key press, then it stays put.
    if (!this.drag?.active) {
      this.free += this.freeVel * dt;
      this.freeVel *= Math.exp(-dt * 3.5);
    }

    const ease = 1 - Math.exp(-dt * 3);
    this.look.x += (this.look.tx - this.look.x) * ease;
    this.look.y += (this.look.ty - this.look.y) * ease;

    this.yaw = this.tour + this.free + this.compass + this.look.x;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.freePitch + this.compassPitch + this.look.y));

    const omega = (this.yaw - this.prevYaw) / dt;
    this.prevYaw = this.yaw;
    this.omega += (omega - this.omega) * (1 - Math.exp(-dt * 8));
    const calm = Math.abs(this.omega) < 0.04;
    this.stillness = Math.max(0, Math.min(1, this.stillness + (calm ? dt / 5 : -dt * 1.5)));

    this.drawCompass();
    return this;
  }

  /** Turn by an angle, as if dragged. */
  nudge(angle: number) {
    this.freeVel += angle * 3.5;
  }

  private drawCompass() {
    const deg = Math.round(((this.yaw * 180) / Math.PI) * 10) / 10;
    if (deg === this.shownYaw) return;
    this.shownYaw = deg;
    for (const el of this.compassEls) el.style.setProperty('--yaw', `${deg}deg`);
  }

  private listen() {
    // ── Tour: each section faces you toward its station; the page is one full turn.
    const sections = [...document.querySelectorAll<HTMLElement>('[data-shape]')];
    let previous = 0;
    let turns = 0;
    const angles = sections.map((el) => {
      let a = stationAngle(Number(el.dataset.shape) % STATIONS);
      if (a + turns < previous - 1e-6) turns += TAU;
      a += turns;
      previous = a;
      return a;
    });
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const i = sections.indexOf(el);
          this.station = Number(el.dataset.shape) % STATIONS;
          this.side = (el.dataset.side as Side) ?? 'center';
          this.setTour(angles[i]);
        }
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    sections.forEach((el) => io.observe(el));

    // ── Drag / swipe with momentum; a short press without movement is a tap.
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      const touch = e.pointerType !== 'mouse';
      // With a mouse, text stays selectable; dragging starts on open space.
      const text = !touch && e.target instanceof Element && !!e.target.closest(TEXT);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), touch, text, moved: false, active: false, swiped: false };
    });

    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'mouse') {
          this.look.tx = ((e.clientX / window.innerWidth) * 2 - 1) * 0.1;
          this.look.ty = -((e.clientY / window.innerHeight) * 2 - 1) * 0.05;
        }
        const d = this.drag;
        if (!d || d.id !== e.pointerId || d.swiped) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.active) {
          if (Math.hypot(dx, dy) < 6) return;
          d.moved = true;
          if (d.text) return;
          // On touch, vertical swipes belong to scrolling.
          if (d.touch && Math.abs(dy) > Math.abs(dx)) {
            d.swiped = true;
            return;
          }
          d.active = true;
          document.documentElement.classList.add('is-looking');
          window.getSelection()?.removeAllRanges();
          window.dispatchEvent(new CustomEvent('zen:look'));
        }
        const now = performance.now();
        const dt = Math.max((now - d.t) / 1000, 1e-3);
        // Dragging the world: pull it left to turn right. A full screen width is half a turn.
        const turn = (-(e.clientX - d.x) / window.innerWidth) * Math.PI;
        this.free += turn;
        // Momentum from a smoothed, capped velocity, so a quick flick glides but never spins.
        this.freeVel += (Math.max(-4, Math.min(4, turn / dt)) - this.freeVel) * 0.4;
        if (!d.touch) {
          this.freePitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.freePitch + ((e.clientY - d.y) / window.innerHeight) * 0.8));
        }
        d.x = e.clientX;
        d.y = e.clientY;
        d.t = now;
      },
      { passive: true },
    );

    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      document.documentElement.classList.remove('is-looking');
      if (e.type === 'pointerup' && !d.moved && !isInteractive(e.target)) {
        window.dispatchEvent(new CustomEvent('zen:tap', { detail: { x: e.clientX, y: e.clientY } }));
      }
      // A drag that ended at rest should not fling.
      if (performance.now() - d.t > 80) this.freeVel = 0;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isInteractive(e.target)) return;
      if (e.key === 'ArrowLeft') this.nudge(-Math.PI / 6);
      else if (e.key === 'ArrowRight') this.nudge(Math.PI / 6);
    });

    // ── A phone's own heading turns you fully around.
    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null || e.beta === null) return;
      this.heading0 ??= e.alpha;
      this.beta0 ??= e.beta;
      // alpha grows as the phone turns left; yaw grows to the right.
      this.compass = (-(e.alpha - this.heading0) * Math.PI) / 180;
      this.compassPitch = ((e.beta - this.beta0) * Math.PI) / 180;
    });
  }

  private setTour(angle: number) {
    this.tourBase = angle;
    if (!this.tourReady) {
      this.tour = angle - (this.side === 'right' ? this.sideAngle : 0);
      this.tourReady = true;
    }
  }

  /** Called by the scene when the viewport changes. */
  setSideAngle(angle: number) {
    this.sideAngle = angle;
  }
}

let instance: Heading | null = null;

/** The one shared heading, created on first use. */
export function getHeading() {
  instance ??= new Heading();
  return instance;
}

export type { Heading };
