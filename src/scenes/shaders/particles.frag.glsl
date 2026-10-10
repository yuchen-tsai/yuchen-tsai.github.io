uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;

varying float vAlpha;
varying float vAccent;

void main() {
  // Soft round point; the falloff stands in for bloom at zero extra cost.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = pow(1.0 - d * 2.0, 1.7);
  vec3 color = mix(uColor, uAccent, vAccent);
  gl_FragColor = vec4(color, a * vAlpha * uOpacity);
}
