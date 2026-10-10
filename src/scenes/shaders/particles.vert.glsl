// Everything around you in one draw call. Station particles blend six
// formations via uWeights; the rest (sand, motes, stars, sound glints) are
// placed once and animated here. aGroup says which is which.
uniform float uTime;
uniform float uWeights[6];
uniform vec2 uMouse;          // cursor, normalized device coordinates
uniform vec2 uMouseVel;
uniform float uMouseStrength;
uniform float uAspect;
uniform vec4 uRipples[8];     // xyz origin, w = start time (< 0 inactive)
uniform float uRippleAmp[8];
uniform vec4 uVoices[2];      // orbiting sound sources: xyz, w = presence
uniform vec2 uForward;        // where you face, on the ground plane
uniform float uOmega;         // turning speed, rad/s
uniform float uTurn;          // recent turning, slowly decaying
uniform float uStill;         // 0 restless … 1 calm
uniform float uIntro;         // 1 at load: mist condensing
uniform float uNight;         // 0 day … 1 night
uniform float uSize;
uniform float uPixelRatio;
uniform float uRefDist;

attribute vec4 aShape0;
attribute vec4 aShape1;
attribute vec4 aShape2;
attribute vec4 aShape3;
attribute vec4 aShape4;
attribute vec4 aShape5;
attribute vec4 aRandom;
attribute float aGroup;

varying float vAlpha;
varying float vAccent;

// Simplex 3D noise — Ashima Arts / Ian McEwan (MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  float g = aGroup;
  float isPool = 1.0 - step(0.5, g);
  float isStation = 1.0 - step(2.5, g);       // pool, resident, moon
  float isSand = step(2.5, g) * (1.0 - step(3.5, g));
  float isMote = step(3.5, g) * (1.0 - step(4.5, g));
  float isStar = step(4.5, g) * (1.0 - step(5.5, g));
  float isGlint = step(5.5, g);

  // Pool particles stream between stations; each has its own easing exponent,
  // so a transition ripples through the cloud instead of moving in lockstep.
  vec4 shape = aShape0;
  float turbulence = 0.0;
  if (isPool > 0.5) {
    float k = mix(0.45, 2.4, aRandom.x);
    float w0 = pow(uWeights[0], k);
    float w1 = pow(uWeights[1], k);
    float w2 = pow(uWeights[2], k);
    float w3 = pow(uWeights[3], k);
    float w4 = pow(uWeights[4], k);
    float w5 = pow(uWeights[5], k);
    float sum = max(w0 + w1 + w2 + w3 + w4 + w5, 1e-4);
    shape = (aShape0 * w0 + aShape1 * w1 + aShape2 * w2 + aShape3 * w3 + aShape4 * w4 + aShape5 * w5) / sum;
    float settled = max(max(max(w0, w1), max(w2, w3)), max(w4, w5)) / sum;
    turbulence = smoothstep(1.0, 0.45, settled);
  }

  vec3 p = shape.xyz;

  if (isGlint > 0.5) {
    vec4 v = g < 6.5 ? uVoices[0] : uVoices[1];
    p = v.xyz + p * (0.5 + 0.8 * v.w);
  }

  // Attention: what you face gathers light; what is behind you relaxes into mist.
  float facing = dot(normalize(p.xz + 1e-4), uForward);
  float att = smoothstep(0.55, 0.98, facing);

  // Breathing, deeper when you are still.
  p *= 1.0 + isStation * 0.012 * (1.0 + uStill) * sin(uTime * 0.6 + aRandom.y * 0.5);

  // Mist: low-frequency drift, stronger while changing form, behind you, or restless.
  vec3 q = p * 0.5 + vec3(0.0, uTime * 0.04, uTime * 0.03);
  vec3 drift = vec3(snoise(q), snoise(q + 17.1), snoise(q + 31.7));
  float calm = 1.0 - 0.6 * uStill;
  float mist = isStation * ((0.03 + turbulence * 0.75) * calm * (1.0 + 0.8 * (1.0 - att)) + uIntro * 3.0)
    + isMote * 0.45 + isSand * 0.01 + isGlint * 0.03;
  p += drift * mist;

  // Motes rise slowly and wrap around.
  if (isMote > 0.5) p.y = -1.6 + mod(p.y + 1.6 + uTime * 0.05 * (0.4 + aRandom.z), 5.5);

  // Sand: a slow swell, and ripples running outward while you turn.
  float r = length(p.xz);
  p.y += isSand * (sin(r * 2.0 - uTime * 0.6) * 0.012 + sin(r * 5.0 - uTime * 2.4) * 0.07 * uTurn);

  // Turning: the floating mist (motes, sand grains, sound glints) trails behind
  // and flutters; the station shapes stay solid and turn with the world.
  float near = clamp(4.0 / max(r, 0.1), 0.0, 1.0) * (isMote + isSand + isGlint);
  float lag = -uOmega * 0.1 * near * (0.4 + aRandom.y);
  float cl = cos(lag);
  float sl = sin(lag);
  p.xz = vec2(p.x * cl - p.z * sl, p.x * sl + p.z * cl);
  p.y += drift.x * abs(uOmega) * 0.12 * near;

  // Ripples: shells expanding from where a sound (or a tap) happened.
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipples[i];
    float age = uTime - rp.w;
    if (rp.w >= 0.0 && age < 6.0) {
      vec3 d = p - rp.xyz;
      float dd = length(d);
      float band = uRippleAmp[i] * exp(-pow((dd - age * 1.6) * 2.6, 2.0)) * exp(-age * 0.7);
      p += (d / max(dd, 1e-3)) * band * 0.18 * (1.0 - isStar);
      glow += band;
    }
  }

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;

  // Cursor: particles part and bend with the motion, like wind through bamboo.
  vec4 clip = projectionMatrix * mv;
  vec2 dn = clip.xy / max(clip.w, 1e-3) - uMouse;
  dn.x *= uAspect;
  float dist = length(dn);
  float fall = exp(-dist * dist * 14.0) * uMouseStrength * (1.0 - isStar);
  mv.xy += ((dn / max(dist, 1e-3)) * 0.05 + uMouseVel * 0.06) * fall * depth * 0.4;

  gl_Position = projectionMatrix * mv;

  float isMoon = step(1.5, g) * (1.0 - step(2.5, g));
  float sizeK = 1.0 + isStar * 1.5 + isMote * 0.4 + isGlint * 0.7 + isSand * 0.3 + isMoon * 0.5;
  float size = uSize * sizeK * mix(0.5, 1.5, aRandom.z) * (1.0 + shape.w * 0.8);
  gl_PointSize = depth < 0.05 ? 0.0 : clamp(size * uPixelRatio * (uRefDist / depth), 1.0 * uPixelRatio, 7.0 * uPixelRatio);

  float twinkle = 0.78 + 0.22 * sin(uTime * (0.4 + aRandom.y) + aRandom.x * 6.2831);

  // Fireflies at night: a few motes blink in the accent color.
  float fly = step(0.55, aRandom.w) * isMote;
  float blink = pow(0.5 + 0.5 * sin(uTime * (0.7 + aRandom.y) + aRandom.x * 20.0), 6.0);

  float alpha =
    isPool * (0.55 + 0.6 * att) +
    step(0.5, g) * (1.0 - step(1.5, g)) * (0.7 + 0.4 * att) +
    isMoon * 1.4 * uNight * (0.5 + 0.6 * att) +
    isSand * 0.5 * smoothstep(10.0, 7.0, r) +
    isMote * mix(0.35, 0.2 + 1.3 * blink * fly, uNight) +
    isStar * 0.9 * uNight +
    isGlint * (g < 6.5 ? uVoices[0].w : uVoices[1].w);

  vAlpha = alpha * mix(0.35, 1.0, aRandom.w) * twinkle * (1.0 + glow * 1.5);
  vAccent = clamp(shape.w * (1.0 - isStar * (1.0 - uNight)) + glow * 0.8 + uNight * fly * blink, 0.0, 1.0);
}
