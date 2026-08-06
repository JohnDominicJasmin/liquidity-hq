'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { motion } from 'motion/react';

interface Beam {
  x: number;
  y: number;
  width: number;
  length: number;
  angle: number;
  speed: number;
  opacity: number;
  hue: number;
  pulse: number;
  pulseSpeed: number;
}

function createBeam(width: number, height: number): Beam {
  const angle = -35 + Math.random() * 10;
  return {
    x: Math.random() * width * 1.5 - width * 0.25,
    y: Math.random() * height * 1.5 - height * 0.25,
    width: 30 + Math.random() * 60,
    length: height * 2.5,
    angle,
    speed: 0.6 + Math.random() * 1.2,
    opacity: 0.10 + Math.random() * 0.14,
    hue: 215 + Math.random() * 40,  // blue-indigo range, avoids violet end
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.02 + Math.random() * 0.03,
  };
}

const OPACITY_MAP = { subtle: 0.6, medium: 0.8, strong: 1 };

/* WCAG 2.2.2 Pause, Stop, Hide is Level A, and this component paints the FIRST
   thing a visitor sees on the public marketing homepage.
   Two things here ran forever with no way to stop them: the requestAnimationFrame
   loop below, and the Motion opacity pulse at the bottom of this file. Neither
   checked prefers-reduced-motion, so someone who had asked their operating system
   to reduce motion got both anyway.
   Not a deliberate exception - the app honours the setting in four other places
   (globals.css, SpotlightTour.tsx). This file was missed.

   Read through useSyncExternalStore rather than useState + useEffect because a
   media query IS an external store, and the setState-in-an-effect version trips
   the React Compiler's cascading-render rule. It also gives a defined value on
   the very first render instead of a frame of "unknown". */
const REDUCE_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReduceMotion(onChange: () => void) {
  // Subscribed, not read once: the setting can change mid-session, and a user
  // toggling it is the clearest statement of intent there is.
  const mq = window.matchMedia(REDUCE_MOTION);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const readReduceMotion = () => window.matchMedia(REDUCE_MOTION).matches;

/* Server-side there is no media query to read, so assume reduced. Erring toward
   "still" means the worst case is one static frame before hydration corrects it,
   rather than motion reaching someone who asked for none. */
const readReduceMotionOnServer = () => true;

export function BeamsBackground({ intensity = 'strong' }: { intensity?: 'subtle' | 'medium' | 'strong' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamsRef = useRef<Beam[]>([]);
  const rafRef = useRef<number>(0);

  const reduceMotion = useSyncExternalStore(
    subscribeReduceMotion,
    readReduceMotion,
    readReduceMotionOnServer,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const getSize = () => {
      const p = canvas.parentElement;
      return { w: p ? p.offsetWidth : window.innerWidth, h: p ? p.offsetHeight : window.innerHeight };
    };

    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = getSize();
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
      beamsRef.current = Array.from({ length: 30 }, () => createBeam(w, h));
    };

    const resetBeam = (beam: Beam, index: number, total: number) => {
      const { w, h } = getSize();
      const col = index % 3;
      const spacing = w / 3;
      beam.y = h + 100;
      beam.x = col * spacing + spacing / 2 + (Math.random() - 0.5) * spacing * 0.5;
      beam.width = 100 + Math.random() * 100;
      beam.speed = 0.5 + Math.random() * 0.4;
      beam.hue = 215 + (index * 40) / total;
      beam.opacity = 0.15 + Math.random() * 0.1;
      return beam;
    };

    const drawBeam = (beam: Beam) => {
      const { h } = getSize();
      ctx.save();
      ctx.translate(beam.x, beam.y);
      ctx.rotate((beam.angle * Math.PI) / 180);
      const op = beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.2) * OPACITY_MAP[intensity];
      const g = ctx.createLinearGradient(0, 0, 0, beam.length);
      g.addColorStop(0,   `hsla(${beam.hue}, 85%, 65%, 0)`);
      g.addColorStop(0.1, `hsla(${beam.hue}, 85%, 65%, ${op * 0.5})`);
      g.addColorStop(0.4, `hsla(${beam.hue}, 85%, 65%, ${op})`);
      g.addColorStop(0.6, `hsla(${beam.hue}, 85%, 65%, ${op})`);
      g.addColorStop(0.9, `hsla(${beam.hue}, 85%, 65%, ${op * 0.5})`);
      g.addColorStop(1,   `hsla(${beam.hue}, 85%, 65%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(-beam.width / 2, 0, beam.width, beam.length);
      ctx.restore();
    };

    /* Draws exactly one frame. Advancing the beams and scheduling the next frame
       are both skipped under reduced motion, so the artwork still paints - it
       just never moves.
       Deliberately not "render nothing": 2.2.2 objects to movement, not to the
       image, and a blank hero would punish someone for setting the preference.
       The still frame is the same composition, frozen. */
    const animate = () => {
      const { w, h } = getSize();
      ctx.clearRect(0, 0, w, h);
      ctx.filter = 'blur(35px)';
      const total = beamsRef.current.length;
      beamsRef.current.forEach((beam, i) => {
        if (!reduceMotion) {
          beam.y -= beam.speed;
          beam.pulse += beam.pulseSpeed;
          if (beam.y + beam.length < -100) resetBeam(beam, i, total);
        }
        drawBeam(beam);
      });
      if (!reduceMotion) rafRef.current = requestAnimationFrame(animate);
    };

    setup();
    // Still repaints on resize when frozen, or the frame stretches.
    const onResize = () => { setup(); if (reduceMotion) animate(); };
    window.addEventListener('resize', onResize);
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [intensity, reduceMotion]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          filter: 'blur(15px)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* subtle depth pulse overlay */}
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(7, 9, 15, 0.15)',
          backdropFilter: 'blur(40px)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
        /* The second half of the 2.2.2 fix. This pulsed forever via
           repeat: Infinity regardless of the user's preference. Under reduced
           motion it holds a fixed opacity at the midpoint of the range it used
           to travel, so the depth effect survives without the movement. */
        animate={reduceMotion ? { opacity: 0.125 } : { opacity: [0.05, 0.2, 0.05] }}
        transition={reduceMotion
          ? { duration: 0 }
          : { duration: 10, ease: 'easeInOut', repeat: Infinity }}
      />
    </>
  );
}
