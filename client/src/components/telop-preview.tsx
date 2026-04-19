import { useRef, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import type { Project, LyricLine } from "@shared/schema";

interface TelopPreviewProps {
  project: Project;
  lyrics: LyricLine[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  seekTo: (time: number) => void;
  activeLyricIndex: number;
  hasAudio: boolean;
}

export function TelopPreview({
  project,
  lyrics,
  audioRef,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  seekTo,
  activeLyricIndex,
  hasAudio,
}: TelopPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const outputW = project.outputWidth || 1920;
  const outputH = project.outputHeight || 500;
  const fontSize = project.fontSize || 48;
  const fontFamily = project.fontFamily || "Noto Sans JP";
  const fontColor = project.fontColor || "#FFFFFF";
  const strokeColor = project.strokeColor || "#000000";
  const strokeWidth = project.strokeWidth || 3;

  const activeText = activeLyricIndex >= 0 ? lyrics[activeLyricIndex].text : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = outputW;
    canvas.height = outputH;

    ctx.clearRect(0, 0, outputW, outputH);

    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, outputW, outputH);

    const checkerSize = 16;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let y = 0; y < outputH; y += checkerSize * 2) {
      for (let x = 0; x < outputW; x += checkerSize * 2) {
        ctx.fillRect(x, y, checkerSize, checkerSize);
        ctx.fillRect(x + checkerSize, y + checkerSize, checkerSize, checkerSize);
      }
    }

    if (activeText) {
      ctx.font = `bold ${fontSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth * 2;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(activeText, outputW / 2, outputH / 2);
      }

      ctx.fillStyle = fontColor;
      ctx.fillText(activeText, outputW / 2, outputH / 2);
    }
  }, [activeText, outputW, outputH, fontSize, fontFamily, fontColor, strokeColor, strokeWidth]);

  if (!hasAudio) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        プレビューを表示するには音楽ファイルをアップロードしてください
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">テロップ プレビュー</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {outputW} x {outputH}px — 透過背景 (チェッカーボードは透明部分)
        </p>
        <div className="overflow-auto border rounded-md bg-black">
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              maxHeight: "300px",
              objectFit: "contain",
            }}
            data-testid="canvas-preview"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" onClick={togglePlay} data-testid="preview-play">
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1 text-center">
            {activeLyricIndex >= 0 && (
              <span className="text-sm font-medium" data-testid="text-active-lyric">
                {lyrics[activeLyricIndex].text}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
