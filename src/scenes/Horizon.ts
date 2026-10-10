import { BackSide, CanvasTexture, CylinderGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { Theme } from './ParticleField';
import { TAU } from './world';

const RADIUS = 32;
const BOTTOM = -2.5;
const TOP = 9;
const W = 4096;
const H = 512;

const PALETTE: Record<Theme, { ink: string; opacity: number }> = {
  light: { ink: '#24211e', opacity: 0.5 },
  dark: { ink: '#d8d1c2', opacity: 0.2 },
};

/** Ridge height in world units; integer frequencies so the panorama wraps seamlessly. */
function ridge(a: number, far: number) {
  return (
    (2.4 +
      1.4 * Math.sin(2 * a + 0.3 + far * 2) +
      0.9 * Math.sin(5 * a + 1.7 + far) +
      0.45 * Math.sin(11 * a + 0.4) +
      0.2 * Math.sin(23 * a + far * 3)) *
      (far ? 1.15 : 0.85) +
    far * 1.4
  );
}

/**
 * Ink-wash mountains painted once onto a cylinder around you: dark along the
 * ridge, washing out below, with a paler far range behind. One draw call.
 */
export class Horizon {
  readonly mesh: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private base = 0.5;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const toY = (y: number) => (H * (TOP - y)) / (TOP - BOTTOM);

    // Many offset strokes of the ridge line build up a wash that fades downward.
    for (const [far, strength] of [
      [1, 0.45],
      [0, 0.9],
    ]) {
      for (let i = 0; i < 90; i++) {
        const alpha = strength * 0.085 * Math.exp(-i / 22);
        g.strokeStyle = `rgba(255,255,255,${alpha})`;
        g.lineWidth = 3 + i * 0.08;
        g.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const a = (x / W) * TAU;
          // A little brush wobble, stronger lower down.
          const wobble = Math.sin(a * 140 + i * 1.7) * (0.4 + i * 0.04);
          const y = toY(ridge(a, far)) + i * 1.6 + wobble;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    const texture = new CanvasTexture(canvas);
    texture.anisotropy = 4;
    const material = new MeshBasicMaterial({
      alphaMap: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: BackSide,
    });
    this.mesh = new Mesh(new CylinderGeometry(RADIUS, RADIUS, TOP - BOTTOM, 160, 1, true), material);
    this.mesh.position.y = (TOP + BOTTOM) / 2;
    this.mesh.renderOrder = -2;
  }

  setTheme(theme: Theme) {
    this.mesh.material.color.set(PALETTE[theme].ink);
    this.base = PALETTE[theme].opacity;
  }

  setOpacity(k: number) {
    this.mesh.material.opacity = this.base * k;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.alphaMap?.dispose();
    this.mesh.material.dispose();
  }
}
