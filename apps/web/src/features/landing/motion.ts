import { useEffect, useRef, useState, type RefObject } from 'react';

/** True when the visitor asked the system for less motion (or the environment cannot tell). */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Becomes true once the element has entered the viewport and stays true (one-time reveals).
 * Without IntersectionObserver (jsdom, very old browsers) everything counts as seen.
 */
export function useSeen<T extends Element>(threshold = 0.35): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/**
 * Writes `--progress` (0..1) on the element while it travels from the bottom of the viewport to
 * `endAt` (fraction of the viewport height from the top). Uses CSSOM, which the strict CSP allows,
 * and at most one write per animation frame.
 */
export function useScrollProgress<T extends HTMLElement>(endAt = 0.35): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) {
      element.style.setProperty('--progress', '1');
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const start = viewport;
      const end = viewport * endAt;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      element.style.setProperty('--progress', progress.toFixed(4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [endAt]);
  return ref;
}

/**
 * Index of the item that currently crosses the middle band of the viewport, for scroll-driven
 * sequences and for marking the section in view in the navigation.
 */
export function useActiveIndex(selector: string, container: RefObject<HTMLElement | null>, initial = 0): number {
  const [active, setActive] = useState(initial);
  useEffect(() => {
    const root = container.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(items.indexOf(entry.target as HTMLElement));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [selector, container]);
  return active;
}
