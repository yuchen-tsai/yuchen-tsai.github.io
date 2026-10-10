import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector4,
} from 'three';
import vertexShader from './shaders/particles.vert.glsl?raw';
import fragmentShader from './shaders/particles.frag.glsl?raw';
import { buildWorld, mulberry32, SHAPE_COUNT } from './shapes';
import { ORBITERS, type Vec3 } from './world';

export type Theme = 'light' | 'dark';

const PALETTE: Record<Theme, { ink: string; accent: string; opacity: number }> = {
  light: { ink: '#24211e', accent: '#a2482f', opacity: 0.62 },
  dark: { ink: '#d8d1c2', accent: '#e0906a', opacity: 0.55 },
};

export const RIPPLES = 8;

/** One draw call: the whole garden around you, animated in the vertex shader. */
export class ParticleField {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly weights = new Float32Array(SHAPE_COUNT);
  private rippleIndex = 0;

  readonly count: number;

  constructor(budget: number) {
    const geometry = new BufferGeometry();
    const world = buildWorld(budget);
    const count = (this.count = world.count);
    // `position` is required by three.js for bounds; aShape0 carries the real data.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    world.shapes.forEach((data, i) => geometry.setAttribute(`aShape${i}`, new BufferAttribute(data, 4)));
    geometry.setAttribute('aGroup', new BufferAttribute(world.group, 1));

    const rand = mulberry32(7);
    const random = new Float32Array(count * 4);
    for (let i = 0; i < random.length; i++) random[i] = rand();
    geometry.setAttribute('aRandom', new BufferAttribute(random, 4));

    this.weights[0] = 1;

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uWeights: { value: this.weights },
        uMouse: { value: new Vector2(9, 9) },
        uMouseVel: { value: new Vector2() },
        uMouseStrength: { value: 0 },
        uAspect: { value: 1 },
        uRipples: { value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, 0, -1)) },
        uRippleAmp: { value: new Float32Array(RIPPLES) },
        uVoices: { value: ORBITERS.map(() => new Vector4()) },
        uForward: { value: new Vector2(0, -1) },
        uOmega: { value: 0 },
        uTurn: { value: 0 },
        uStill: { value: 0 },
        uIntro: { value: 1 },
        uNight: { value: 0 },
        uSize: { value: 2.2 },
        uPixelRatio: { value: 1 },
        uRefDist: { value: 6 },
        uColor: { value: new Color() },
        uAccent: { value: new Color() },
        uOpacity: { value: 0 },
      },
    });

    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
  }

  get uniforms() {
    return this.points.material.uniforms;
  }

  setTheme(theme: Theme) {
    const p = PALETTE[theme];
    this.uniforms.uColor.value.set(p.ink);
    this.uniforms.uAccent.value.set(p.accent);
    // Light ink on dark paper glows; dark ink on light paper layers like sumi.
    this.points.material.blending = theme === 'dark' ? AdditiveBlending : NormalBlending;
    this.points.material.needsUpdate = true;
    return p.opacity;
  }

  /** Show only the first n particles (shapes are pre-shuffled, so any prefix is representative). */
  setVisibleCount(n: number) {
    this.points.geometry.setDrawRange(0, Math.min(n, this.count));
  }

  /** A shell of light expanding from a world point; `amp` 1 is a tap, sounds are softer. */
  ripple([x, y, z]: Vec3, time: number, amp = 1) {
    this.uniforms.uRipples.value[this.rippleIndex].set(x, y, z, time);
    this.uniforms.uRippleAmp.value[this.rippleIndex] = amp;
    this.rippleIndex = (this.rippleIndex + 1) % RIPPLES;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
