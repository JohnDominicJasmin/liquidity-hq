'use client';

import { useEffect, useRef } from 'react';
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

export function BeamsBackground({ intensity = 'strong' }: { intensity?: 'subtle' | 'medium' | 'strong' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beamsRef = useRef<Beam[]>([]);
  const rafRef = useRef<number>(0);

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

    const animate = () => {
      const { w, h } = getSize();
      ctx.clearRect(0, 0, w, h);
      ctx.filter = 'blur(35px)';
      const total = beamsRef.current.length;
      beamsRef.current.forEach((beam, i) => {
        beam.y -= beam.speed;
        beam.pulse += beam.pulseSpeed;
        if (beam.y + beam.length < -100) resetBeam(beam, i, total);
        drawBeam(beam);
      });
      rafRef.current = requestAnimationFrame(animate);
    };

    setup();
    window.addEventListener('resize', setup);
    animate();

    return () => {
      window.removeEventListener('resize', setup);
      cancelAnimationFrame(rafRef.current);
    };
  }, [intensity]);

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
        animate={{ opacity: [0.05, 0.2, 0.05] }}
        transition={{ duration: 10, ease: 'easeInOut', repeat: Infinity }}
      />
    </>
  );
}
