import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { gsap } from 'gsap';
import { ParticleField, type Theme } from './ParticleField';
import { Interaction } from './Interaction';
import { Horizon } from './Horizon';
import { Ground } from './Ground';
import { SHAPE_COUNT } from './shapes';
import { getHeading } from './heading';
import { ORBITERS, STATION_DISTANCE, fovFor, orbitPosition, screenToWorld, sound, type NoteDetail } from './world';

interface Tier {
  budget: number;
  dpr: number;
}

/** Starting budgets; the scene steps down at runtime if frames run long. */
function pickTier(): Tier {
  const small = matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (small) return { budget: 10000, dpr: 1.25 };
  if (cores <= 4) return { budget: 14000, dpr: 1.25 };
  return { budget: 20000, dpr: 1.5 };
}

/** You stand at the center of the garden; the camera is your eyes. */
export function start(container: HTMLElement) {
  const root = document.documentElement;
  const tier = pickTier();
  const heading = getHeading();

  const renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.dpr));
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.05, 120);
  camera.rotation.order = 'YXZ';
  const field = new ParticleField(tier.budget);
  const horizon = new Horizon();
  const ground = new Ground();
  scene.add(horizon.mesh, ground.mesh, field.points);

  const u = field.uniforms;
  u.uPixelRatio.value = renderer.getPixelRatio();

  // Tweened state.
  const mix: Record<string, number> = {};
  for (let i = 0; i < SHAPE_COUNT; i++) mix[`w${i}`] = i === heading.station ? 1 : 0;
  const look = { dim: 1, night: root.dataset.theme === 'dark' ? 1 : 0 };
  const fade = { value: 0 };
  const theme0 = (root.dataset.theme as Theme) ?? 'light';
  let baseOpacity = field.setTheme(theme0);
  horizon.setTheme(theme0);
  ground.setTheme(theme0);
  let wide = true;
  let station = heading.station;
  let turn = 0;
  const voices = ORBITERS.map(() => 0);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    wide = camera.aspect > 1.15;
    u.uAspect.value = camera.aspect;
    u.uSize.value = wide ? 2.2 : 1.9;
    // Look this far left of a station so it sits in the right part of the screen.
    const halfWidth = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    heading.setSideAngle(wide ? Math.atan(0.48 * Math.tan(halfWidth)) : 0);
  }

  function go(next: number) {
    station = next;
    const targets: Record<string, number> = {};
    for (let i = 0; i < SHAPE_COUNT; i++) targets[`w${i}`] = i === next ? 1 : 0;
    gsap.to(mix, { ...targets, duration: 3.2, ease: 'sine.inOut', overwrite: 'auto' });
  }

  const interaction = new Interaction();

  // ── Taps and sounds ripple the garden where they happen ─
  const onTap = (e: Event) => {
    const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
    field.ripple(screenToWorld(x, y, heading.yaw, heading.pitch, STATION_DISTANCE), u.uTime.value, 1);
  };
  const onNote = (e: Event) => {
    const { at, amp } = (e as CustomEvent<NoteDetail>).detail;
    field.ripple(at, u.uTime.value, amp);
  };
  window.addEventListener('zen:tap', onTap);
  window.addEventListener('zen:note', onNote);

  // ── Theme ──────────────────────────────────────────────
  const onTheme = (e: Event) => {
    const theme = (e as CustomEvent<Theme>).detail;
    gsap.to(fade, {
      value: 0,
      duration: 0.5,
      ease: 'sine.in',
      overwrite: true,
      onComplete: () => {
        baseOpacity = field.setTheme(theme);
        horizon.setTheme(theme);
        ground.setTheme(theme);
        gsap.to(fade, { value: 1, duration: 1.4, ease: 'sine.out' });
      },
    });
    gsap.to(look, { night: theme === 'dark' ? 1 : 0, duration: 2.4, ease: 'sine.inOut' });
  };
  window.addEventListener('zen:theme', onTheme);

  // ── Render loop ────────────────────────────────────────
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let sampled = 0;
  let downgraded = false;

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;

    // Adaptive quality: after the intro, measure ~2.5 s of frames once.
    if (!downgraded && elapsed > 1.5 && elapsed < 4) {
      frames++;
      sampled += dt;
    } else if (!downgraded && elapsed >= 4 && frames > 0) {
      if (sampled / frames > 1 / 45) {
        field.setVisibleCount(Math.round(field.count * 0.55));
        renderer.setPixelRatio(1);
        u.uPixelRatio.value = 1;
      }
      downgraded = true;
    }

    heading.update();
    if (heading.station !== station) go(heading.station);
    camera.rotation.set(heading.pitch, -heading.yaw, 0);

    // On narrow screens the station sits behind the text, so the garden steps back.
    const dim = !wide && heading.side === 'right' ? 0.5 : 1;
    look.dim += (dim - look.dim) * (1 - Math.exp(-dt * 2));

    interaction.update(dt);
    for (let i = 0; i < SHAPE_COUNT; i++) field.weights[i] = Math.max(mix[`w${i}`], 0);

    const omega = heading.omega;
    turn = Math.max(Math.min(Math.abs(omega), 2.5), turn * Math.exp(-dt * 0.6));

    // Orbiting sound sources glow while the sound is on, brighter as they play.
    ORBITERS.forEach((orbit, i) => {
      sound.activity[i] *= Math.exp(-dt * 1.6);
      voices[i] += (sound.level * (0.35 + 0.65 * sound.activity[i]) - voices[i]) * (1 - Math.exp(-dt * 3));
      const [x, y, z] = orbitPosition(orbit, sound.clock);
      u.uVoices.value[i].set(x, y, z, voices[i]);
    });

    u.uTime.value = elapsed;
    u.uMouse.value.copy(interaction.ndc);
    u.uMouseVel.value.copy(interaction.velocity);
    u.uMouseStrength.value = interaction.strength;
    u.uForward.value.set(Math.sin(heading.yaw), -Math.cos(heading.yaw));
    u.uOmega.value = Math.max(-3, Math.min(3, omega));
    u.uTurn.value = turn;
    u.uStill.value = heading.stillness;
    u.uNight.value = look.night;
    u.uOpacity.value = baseOpacity * look.dim * fade.value;
    horizon.setOpacity(look.dim * fade.value);
    // Portrait screens see more ground, so it is drawn lighter.
    ground.update(elapsed, turn, look.dim * fade.value * (wide ? 1 : 0.65));

    renderer.render(scene, camera);
  }

  const play = () => {
    last = performance.now();
    renderer.setAnimationLoop(tick);
  };
  const onVisibility = () => (document.hidden ? renderer.setAnimationLoop(null) : play());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', resize);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    dispose();
  });

  function dispose() {
    renderer.setAnimationLoop(null);
    interaction.dispose();
    window.removeEventListener('zen:theme', onTheme);
    window.removeEventListener('zen:tap', onTap);
    window.removeEventListener('zen:note', onNote);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    field.dispose();
    horizon.dispose();
    ground.dispose();
    renderer.dispose();
    canvas.remove();
    root.classList.remove('has-webgl');
  }

  resize();
  play();
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  gsap.to(fade, { value: 1, duration: 3, ease: 'sine.out' });
  // The mist around you condenses into the garden.
  gsap.to(u.uIntro, { value: 0, duration: 4.5, ease: 'power2.out' });

  return dispose;
}
