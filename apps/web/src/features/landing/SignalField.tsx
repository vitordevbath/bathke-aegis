import { useEffect, useRef, useState } from 'react';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './signal-field-shader';
import { prefersReducedMotion } from './motion';

const MAX_PIXEL_RATIO = 1.5;
/** Line and glow colors (sinal and osso in landing.css), as linear 0..1 RGB for the shader. */
const LINE = [0.56, 0.65, 1.0] as const;
const GLOW = [0.93, 0.94, 0.96] as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** WebGL 2 only where it can exist; jsdom and old browsers simply keep the CSS backdrop. */
function contextOf(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  if (typeof WebGL2RenderingContext === 'undefined') return null;
  try {
    return canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
}

/**
 * Full-bleed contour field behind the hero. Decorative: hidden from assistive technology, never
 * required to read the page. It pauses when off screen or in a background tab, renders one still
 * frame under `prefers-reduced-motion`, and without a pointer the lens drifts on its own path.
 */
export function SignalField({ scroll }: { readonly scroll: { current: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = contextOf(canvas);
    if (!gl) return;
    const program = createProgram(gl);
    if (!program) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle covering the whole viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uResolution = uniform('uResolution');
    const uTime = uniform('uTime');
    const uPointer = uniform('uPointer');
    const uLens = uniform('uLens');
    const uScroll = uniform('uScroll');
    gl.uniform3f(uniform('uLine'), ...LINE);
    gl.uniform3f(uniform('uGlow'), ...GLOW);

    const still = prefersReducedMotion();
    const pointer = { x: 0.72, y: 0.55, targetX: 0.72, targetY: 0.55, lens: 0, targetLens: 0, active: false };
    let frame = 0;
    let visible = true;
    const started = performance.now();

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (now: number) => {
      resize();
      const seconds = still ? 40 : (now - started) / 1000;
      if (!pointer.active && !still) {
        // Without a pointer (touch, keyboard) the lens wanders slowly over the empty side.
        pointer.targetX = 0.72 + 0.14 * Math.sin(seconds * 0.21);
        pointer.targetY = 0.58 + 0.16 * Math.sin(seconds * 0.17 + 1.3);
        pointer.targetLens = 0.65;
      }
      const ease = still ? 1 : 0.08;
      pointer.x += (pointer.targetX - pointer.x) * ease;
      pointer.y += (pointer.targetY - pointer.y) * ease;
      pointer.lens += (pointer.targetLens - pointer.lens) * (still ? 1 : 0.05);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uPointer, pointer.x, pointer.y);
      gl.uniform1f(uLens, still ? 0 : pointer.lens);
      gl.uniform1f(uScroll, scroll.current);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      draw(now);
      frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const resume = () => {
      if (!still && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      const inside = event.clientY >= rect.top && event.clientY <= rect.bottom;
      pointer.active = inside;
      if (!inside) return;
      pointer.targetX = (event.clientX - rect.left) / rect.width;
      pointer.targetY = 1 - (event.clientY - rect.top) / rect.height;
      pointer.targetLens = 1;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            resume();
          });
    observer?.observe(canvas);
    // A still frame is redrawn on resize; an animated one just keeps its loop.
    const onResize = still ? () => draw(performance.now()) : resume;
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('resize', onResize);
    if (!still) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onPointerLeave);
    }

    if (still) draw(performance.now());
    else frame = requestAnimationFrame(loop);
    setReady(true);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, [scroll]);

  return <canvas ref={canvasRef} className={`signal-field${ready ? ' signal-field--ready' : ''}`} aria-hidden="true" />;
}
