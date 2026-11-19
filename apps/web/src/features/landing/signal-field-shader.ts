/**
 * Shaders of the landing hero: contour lines of a slowly drifting noise field ("the terrain the
 * platform observes"), with a lens that bends and lights the lines around the pointer.
 * WebGL 2 (GLSL ES 3.00) for `fwidth`, which keeps every line one device pixel wide at any size.
 */
export const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;   // 0..1, origin bottom-left
uniform float uLens;     // 0..1, how present the lens is
uniform float uScroll;   // 0..1 of the hero scrolled away
uniform vec3 uLine;
uniform vec3 uGlow;

out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotation * p * 2.03;
    amplitude *= 0.5;
  }
  return value;
}

float contour(float value) {
  float width = fwidth(value);
  return 1.0 - min(abs(fract(value - 0.5) - 0.5) / max(width, 1e-4), 1.0);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution.y;
  vec2 pointer = uPointer * vec2(aspect, 1.0);
  vec2 toPointer = uv - pointer;
  float lens = uLens * exp(-dot(toPointer, toPointer) * 9.0);

  vec2 p = uv * 1.35 + vec2(0.0, uScroll * 0.8);
  p -= toPointer * lens * 0.45;
  float t = uTime * 0.03;
  float height = fbm(p + vec2(t, -0.6 * t)) + 0.4 * fbm(p * 0.45 - vec2(0.3 * t, t));

  float levels = height * 26.0;
  float minor = contour(levels);
  float major = contour(levels / 5.0);

  // Strongest on the right, where no text sits; dissolves into the page at the bottom.
  float side = mix(0.28, 1.0, smoothstep(0.15, 0.95, gl_FragCoord.x / uResolution.x));
  float floorFade = smoothstep(0.0, 0.45, gl_FragCoord.y / uResolution.y);
  float presence = side * floorFade * (1.0 - 0.6 * uScroll);

  float alpha = (minor * 0.11 + major * 0.26) * presence;
  alpha += (minor * 0.35 + major * 0.5) * lens * floorFade;
  vec3 color = mix(uLine, uGlow, clamp(lens * 1.4, 0.0, 1.0));
  alpha = clamp(alpha, 0.0, 1.0);
  outColor = vec4(color * alpha, alpha);
}
`;
