/**
 * The shared layout of the garden, used by both the 3D scene and the sound so
 * that what you see and what you hear are always in the same place.
 *
 * You stand at the origin, eyes at y = 0, looking down -z when yaw = 0.
 * Yaw grows clockwise (turning right); six stations ring the horizon.
 */

export type Vec3 = [number, number, number];

export const TAU = Math.PI * 2;
export const STATIONS = 6;
export const STATION_DISTANCE = 6;
export const STATION_HEIGHT = 0.2;
export const GROUND = -1.6;

/** Vertical field of view in degrees; portrait screens get more to see around them. */
export const fovFor = (aspect: number) => (aspect > 1.15 ? 45 : 58);

export const stationAngle = (k: number) => (k * TAU) / STATIONS;

/** The direction you face at a given yaw (and optional pitch). */
export function forward(yaw: number, pitch = 0): Vec3 {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** Turn a point given in a station's own frame (x right, y up, z toward you) into the world. */
export function placeAt(k: number, [x, y, z]: Vec3, distance = STATION_DISTANCE): Vec3 {
  const a = stationAngle(k);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - z * s + Math.sin(a) * distance, y + STATION_HEIGHT, x * s + z * c - Math.cos(a) * distance];
}

export const stationCenter = (k: number) => placeAt(k, [0, 0, 0]);

/** Sources that circle you rather than stay at a station. */
export interface Orbit {
  radius: number;
  period: number;
  phase: number;
  height: number;
  tilt: number;
  dir: 1 | -1;
}

export const ORBITERS: Orbit[] = [
  // Birds by day, insects by night: high and wandering.
  { radius: 3.6, period: 41, phase: 0.6, height: 1.5, tilt: 0.45, dir: 1 },
  // A gust of wind that travels around you.
  { radius: 4.6, period: 29, phase: 3.4, height: 0.1, tilt: 0.3, dir: -1 },
];

export function orbitPosition(o: Orbit, clock: number): Vec3 {
  const a = o.phase + (o.dir * TAU * clock) / o.period;
  return [Math.sin(a) * o.radius, o.height + o.tilt * Math.sin(a * 2), -Math.cos(a) * o.radius];
}

/** The world point under a screen position, `distance` away from you. */
export function screenToWorld(clientX: number, clientY: number, yaw: number, pitch: number, distance: number): Vec3 {
  const aspect = window.innerWidth / window.innerHeight;
  const tanY = Math.tan(((fovFor(aspect) / 2) * Math.PI) / 180);
  const nx = (clientX / window.innerWidth) * 2 - 1;
  const ny = 1 - (clientY / window.innerHeight) * 2;
  // Camera-space ray, then rotate by pitch (about x) and yaw (about y).
  let [x, y, z] = [nx * tanY * aspect, ny * tanY, -1];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  [x, z] = [x * cy - z * sy, x * sy + z * cy];
  const k = distance / Math.hypot(x, y, z);
  return [x * k, y * k, z * k];
}

/** Live sound state the scene can draw: how present the sound is, and its clock. */
export const sound = {
  level: 0,
  clock: 0,
  activity: [0, 0],
};

export interface NoteDetail {
  at: Vec3;
  amp: number;
}
