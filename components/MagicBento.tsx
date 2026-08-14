'use client';

import { useRef, useEffect, useCallback, useState, ReactNode, CSSProperties, RefObject } from 'react';
import { gsap } from 'gsap';
import './MagicBento.css';

export const GLOW_COLOR = '217, 166, 38'; // matches app --accent #d9a626 (#419)
const DEFAULT_PARTICLE_COUNT = 8;
const DEFAULT_SPOTLIGHT_RADIUS = 280;
const MOBILE_BREAKPOINT = 768;

/* ── helpers ── */
function createParticle(x: number, y: number) {
  const el = document.createElement('div');
  el.className = 'mb-particle';
  el.style.cssText = `
    position:absolute;width:3px;height:3px;border-radius:50%;
    background:rgba(${GLOW_COLOR},1);
    box-shadow:0 0 5px rgba(${GLOW_COLOR},0.7);
    pointer-events:none;z-index:100;left:${x}px;top:${y}px;
  `;
  return el;
}

function calcSpotlight(r: number) {
  return { proximity: r * 0.5, fadeDistance: r * 0.75 };
}

function updateGlow(card: HTMLElement, mx: number, my: number, intensity: number, radius: number) {
  const rect = card.getBoundingClientRect();
  card.style.setProperty('--glow-x', `${((mx - rect.left) / rect.width) * 100}%`);
  card.style.setProperty('--glow-y', `${((my - rect.top) / rect.height) * 100}%`);
  card.style.setProperty('--glow-intensity', intensity.toString());
  card.style.setProperty('--glow-radius', `${radius}px`);
}

/* ── ParticleCard ── */
interface ParticleCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  particleCount?: number;
  enableTilt?: boolean;
  enableMagnetism?: boolean;
  clickEffect?: boolean;
  disableAnimations?: boolean;
}

export function ParticleCard({
  children,
  className = '',
  style,
  onClick,
  particleCount = DEFAULT_PARTICLE_COUNT,
  enableTilt = false,
  enableMagnetism = true,
  clickEffect = true,
  disableAnimations = false,
}: ParticleCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLElement[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hoveredRef = useRef(false);
  const magAnimRef = useRef<gsap.core.Tween | null>(null);
  const cachedParticles = useRef<HTMLElement[]>([]);
  const initializedRef = useRef(false);

  const initParticles = useCallback(() => {
    if (initializedRef.current || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    cachedParticles.current = Array.from({ length: particleCount }, () =>
      createParticle(Math.random() * width, Math.random() * height)
    );
    initializedRef.current = true;
  }, [particleCount]);

  const clearParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magAnimRef.current?.kill();
    particlesRef.current.forEach(p => {
      gsap.to(p, {
        scale: 0, opacity: 0, duration: 0.25, ease: 'back.in(1.7)',
        onComplete: () => p.parentNode?.removeChild(p),
      });
    });
    particlesRef.current = [];
  }, []);

  const spawnParticles = useCallback(() => {
    if (!ref.current || !hoveredRef.current) return;
    if (!initializedRef.current) initParticles();
    cachedParticles.current.forEach((template, i) => {
      const tid = setTimeout(() => {
        if (!hoveredRef.current || !ref.current) return;
        const clone = template.cloneNode(true) as HTMLElement;
        ref.current.appendChild(clone);
        particlesRef.current.push(clone);
        gsap.fromTo(clone, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(1.7)' });
        gsap.to(clone, { x: (Math.random() - 0.5) * 80, y: (Math.random() - 0.5) * 80, rotation: Math.random() * 360, duration: 2 + Math.random() * 2, ease: 'none', repeat: -1, yoyo: true });
        gsap.to(clone, { opacity: 0.25, duration: 1.5, ease: 'power2.inOut', repeat: -1, yoyo: true });
      }, i * 80);
      timeoutsRef.current.push(tid);
    });
  }, [initParticles]);

  useEffect(() => {
    if (disableAnimations || !ref.current) return;
    const el = ref.current;

    const onEnter = () => { hoveredRef.current = true; spawnParticles(); };
    const onLeave = () => {
      hoveredRef.current = false;
      clearParticles();
      if (enableTilt) gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.3, ease: 'power2.out' });
      if (enableMagnetism) gsap.to(el, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
    };
    const onMove = (e: MouseEvent) => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (enableTilt) gsap.to(el, { rotateX: ((y - cy) / cy) * -8, rotateY: ((x - cx) / cx) * 8, duration: 0.1, ease: 'power2.out', transformPerspective: 1000 });
      if (enableMagnetism) {
        magAnimRef.current = gsap.to(el, { x: (x - cx) * 0.04, y: (y - cy) * 0.04, duration: 0.3, ease: 'power2.out' });
      }
    };
    const onClickEl = (e: MouseEvent) => {
      if (!clickEffect) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const maxD = Math.max(Math.hypot(x, y), Math.hypot(x - rect.width, y), Math.hypot(x, y - rect.height), Math.hypot(x - rect.width, y - rect.height));
      const ripple = document.createElement('div');
      ripple.style.cssText = `position:absolute;width:${maxD*2}px;height:${maxD*2}px;border-radius:50%;background:radial-gradient(circle,rgba(${GLOW_COLOR},0.35) 0%,rgba(${GLOW_COLOR},0.15) 30%,transparent 70%);left:${x-maxD}px;top:${y-maxD}px;pointer-events:none;z-index:1000;`;
      el.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.75, ease: 'power2.out', onComplete: () => ripple.remove() });
    };

    el.addEventListener('mouseenter', onEnter as EventListener);
    el.addEventListener('mouseleave', onLeave as EventListener);
    el.addEventListener('mousemove', onMove as EventListener);
    el.addEventListener('click', onClickEl as EventListener);
    return () => {
      hoveredRef.current = false;
      el.removeEventListener('mouseenter', onEnter as EventListener);
      el.removeEventListener('mouseleave', onLeave as EventListener);
      el.removeEventListener('mousemove', onMove as EventListener);
      el.removeEventListener('click', onClickEl as EventListener);
      clearParticles();
    };
  }, [spawnParticles, clearParticles, disableAnimations, enableTilt, enableMagnetism, clickEffect]);

  return (
    <div
      ref={ref}
      className={`mb-particle-card ${className}`}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/* ── GlobalSpotlight ── */
interface SpotlightProps {
  gridRef: RefObject<HTMLElement | null>;
  cardSelector?: string;
  radius?: number;
  disableAnimations?: boolean;
}

export function GlobalSpotlight({
  gridRef,
  cardSelector = '.mb-glow-card',
  radius = DEFAULT_SPOTLIGHT_RADIUS,
  disableAnimations = false,
}: SpotlightProps) {
  const spotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disableAnimations || !gridRef?.current) return;

    const spot = document.createElement('div');
    spot.className = 'mb-spotlight';
    spot.style.cssText = `
      position:fixed;width:700px;height:700px;border-radius:50%;pointer-events:none;
      background:radial-gradient(circle,
        rgba(${GLOW_COLOR},0.12) 0%,
        rgba(${GLOW_COLOR},0.06) 18%,
        rgba(${GLOW_COLOR},0.03) 30%,
        rgba(${GLOW_COLOR},0.01) 50%,
        transparent 65%
      );
      z-index:9999;opacity:0;transform:translate(-50%,-50%);mix-blend-mode:screen;
    `;
    document.body.appendChild(spot);
    spotRef.current = spot;

    const { proximity, fadeDistance } = calcSpotlight(radius);

    const onMove = (e: MouseEvent) => {
      const grid = gridRef.current;
      if (!grid || !spotRef.current) return;

      const section = grid.closest('[data-spotlight-section]') ?? grid;
      const rect = section.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;

      const cards = grid.querySelectorAll<HTMLElement>(cardSelector);

      if (!inside) {
        gsap.to(spotRef.current, { opacity: 0, duration: 0.3 });
        cards.forEach(c => c.style.setProperty('--glow-intensity', '0'));
        return;
      }

      let minDist = Infinity;
      cards.forEach(card => {
        const cr = card.getBoundingClientRect();
        const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
        const dist = Math.max(0, Math.hypot(e.clientX - cx, e.clientY - cy) - Math.max(cr.width, cr.height) / 2);
        minDist = Math.min(minDist, dist);
        const intensity = dist <= proximity ? 1 : dist <= fadeDistance ? (fadeDistance - dist) / (fadeDistance - proximity) : 0;
        updateGlow(card, e.clientX, e.clientY, intensity, radius);
      });

      gsap.to(spotRef.current, { left: e.clientX, top: e.clientY, duration: 0.1, ease: 'power2.out' });
      const targetOp = minDist <= proximity ? 0.7 : minDist <= fadeDistance ? ((fadeDistance - minDist) / (fadeDistance - proximity)) * 0.7 : 0;
      gsap.to(spotRef.current, { opacity: targetOp, duration: targetOp > 0 ? 0.2 : 0.4 });
    };

    const onLeave = () => {
      gridRef.current?.querySelectorAll<HTMLElement>(cardSelector).forEach(c => c.style.setProperty('--glow-intensity', '0'));
      if (spotRef.current) gsap.to(spotRef.current, { opacity: 0, duration: 0.3 });
    };

    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove as EventListener);
      document.removeEventListener('mouseleave', onLeave);
      spotRef.current?.remove();
    };
  }, [gridRef, cardSelector, radius, disableAnimations]);

  return null;
}

/* ── mobile detection hook ── */
export function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}
