import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Theme } from './ParticleField';
import { GROUND } from './world';

/** Spacing of the raked rings; sand grains in shapes.ts sit on the same lines. */
export const RAKE = 0.3;

const PALETTE: Record<Theme, { ink: string; opacity: number }> = {
  light: { ink: '#24211e', opacity: 0.2 },
  dark: { ink: '#d8d1c2', opacity: 0.16 },
};

const vertexShader = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uTurn;
  varying vec2 vXZ;

  void main() {
    float r = length(vXZ);
    // Turning sends ripples outward through the rings.
    float rr = r + sin(r * 5.0 - uTime * 2.4) * 0.06 * uTurn + sin(r * 2.0 - uTime * 0.6) * 0.01;
    float d = abs(fract(rr / ${RAKE.toFixed(2)}) - 0.5) * ${RAKE.toFixed(2)};
    // About a pixel wide wherever it is, never thinner than a fine rake line.
    float w = fwidth(rr);
    float line = 1.0 - smoothstep(max(0.004, w * 0.5), max(0.004, w * 0.5) + w, d);
    float fade = smoothstep(2.6, 4.2, r) * smoothstep(12.0, 6.5, r);
    gl_FragColor = vec4(uColor, line * fade * uOpacity);
  }
`;

/** The raked sand you stand in: concentric rings with you as the stone. */
export class Ground {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private base = 0.3;

  constructor() {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Color() },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uTurn: { value: 0 },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(26, 26), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = GROUND;
    this.mesh.renderOrder = -1;
  }

  get uniforms() {
    return this.mesh.material.uniforms;
  }

  setTheme(theme: Theme) {
    this.uniforms.uColor.value.set(PALETTE[theme].ink);
    this.base = PALETTE[theme].opacity;
  }

  update(time: number, turn: number, opacity: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uTurn.value = turn;
    this.uniforms.uOpacity.value = this.base * opacity;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
