// 21st.dev Beams Background (MIT) — 取 canvas 光束层，去除演示文案与深色外壳
import { useEffect, useRef } from "react";

function createBeam(width, height) {
  return {
    x: Math.random() * width * 1.5 - width * 0.25,
    y: Math.random() * height * 1.5 - height * 0.25,
    width: 30 + Math.random() * 60,
    length: height * 2.5,
    angle: -35 + Math.random() * 10,
    speed: 0.6 + Math.random() * 1.2,
    opacity: 0.12 + Math.random() * 0.16,
    hue: 190 + Math.random() * 70,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.02 + Math.random() * 0.03
  };
}

const OPACITY = { subtle: 0.7, medium: 0.85, strong: 1 };

export function BeamsBackground({ intensity = "strong", dark = false, className = "" }) {
  const canvasRef = useRef(null);
  const beamsRef = useRef([]);
  const animationFrameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return undefined; // jsdom 等无 canvas 环境静默降级
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const opacityScale = OPACITY[intensity] || 1;

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      beamsRef.current = Array.from({ length: 30 }, () => createBeam(window.innerWidth, window.innerHeight));
    };

    const resetBeam = (beam, index, totalBeams) => {
      const column = index % 3;
      const spacing = window.innerWidth / 3;
      beam.y = window.innerHeight + 100;
      beam.x = column * spacing + spacing / 2 + (Math.random() - 0.5) * spacing * 0.5;
      beam.width = 100 + Math.random() * 100;
      beam.speed = 0.5 + Math.random() * 0.4;
      beam.hue = 190 + (index * 70) / totalBeams;
      beam.opacity = 0.2 + Math.random() * 0.1;
      return beam;
    };

    const drawBeam = (beam) => {
      ctx.save();
      ctx.translate(beam.x, beam.y);
      ctx.rotate((beam.angle * Math.PI) / 180);
      const pulsingOpacity = beam.opacity * (0.8 + Math.sin(beam.pulse) * 0.2) * opacityScale;
      const lightness = dark ? 65 : 62;
      const alpha = dark ? pulsingOpacity : pulsingOpacity * 0.55;
      const gradient = ctx.createLinearGradient(0, 0, 0, beam.length);
      gradient.addColorStop(0, `hsla(${beam.hue}, 85%, ${lightness}%, 0)`);
      gradient.addColorStop(0.1, `hsla(${beam.hue}, 85%, ${lightness}%, ${alpha * 0.5})`);
      gradient.addColorStop(0.4, `hsla(${beam.hue}, 85%, ${lightness}%, ${alpha})`);
      gradient.addColorStop(0.6, `hsla(${beam.hue}, 85%, ${lightness}%, ${alpha})`);
      gradient.addColorStop(0.9, `hsla(${beam.hue}, 85%, ${lightness}%, ${alpha * 0.5})`);
      gradient.addColorStop(1, `hsla(${beam.hue}, 85%, ${lightness}%, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(-beam.width / 2, 0, beam.width, beam.length);
      ctx.restore();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = "blur(35px)";
      const totalBeams = beamsRef.current.length;
      beamsRef.current.forEach((beam, index) => {
        beam.y -= beam.speed;
        beam.pulse += beam.pulseSpeed;
        if (beam.y + beam.length < -100) resetBeam(beam, index, totalBeams);
        drawBeam(beam);
      });
    };

    const animate = () => {
      if (reducedMotion.matches) { drawFrame(); return; } // 减少动态：画一帧静止
      drawFrame();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);
    animate();

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [intensity, dark]);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
