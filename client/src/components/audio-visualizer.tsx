import { useEffect, useRef, useState } from "react";

interface AudioVisualizerProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  audioUrl: string | null;
}

export function AudioVisualizer({ audioRef, isPlaying, audioUrl }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const setupAudio = () => {
      if (connected) return;
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext();
        }
        const ctx = audioCtxRef.current;
        if (!sourceRef.current) {
          sourceRef.current = ctx.createMediaElementSource(audio);
        }
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        sourceRef.current.connect(analyser);
        sourceRef.current.connect(ctx.destination);
        analyserRef.current = analyser;
        setConnected(true);
      } catch (e) {
        console.warn("Audio visualizer setup:", e);
      }
    };

    audio.addEventListener("play", setupAudio, { once: true });
    if (isPlaying) setupAudio();

    return () => {
      audio.removeEventListener("play", setupAudio);
    };
  }, [audioUrl, audioRef, isPlaying, connected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(dataArray);

      const barCount = Math.min(bufferLength, 80);
      const gap = 1;
      const barW = (w - (barCount - 1) * gap) / barCount;
      const midY = h / 2;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i] / 255;
        const barH = val * midY * 0.9;
        const x = i * (barW + gap);

        const lightness = 45 + (val * 20);
        const alpha = 0.3 + val * 0.5;
        ctx.fillStyle = `hsla(0, 0%, ${lightness}%, ${alpha})`;

        ctx.fillRect(x, midY - barH, barW, barH);
        ctx.fillRect(x, midY, barW, barH);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    if (isPlaying) {
      draw();
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(dataArray);
      const barCount = Math.min(bufferLength, 80);
      const gapS = 1;
      const barWS = (w - (barCount - 1) * gapS) / barCount;
      const midYS = h / 2;
      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i] / 255;
        const barH = val * midYS * 0.5;
        const x = i * (barWS + gapS);
        ctx.fillStyle = `hsla(0, 0%, 50%, 0.15)`;
        ctx.fillRect(x, midYS - barH, barWS, barH);
        ctx.fillRect(x, midYS, barWS, barH);
      }
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, connected]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      data-testid="canvas-visualizer"
    />
  );
}
