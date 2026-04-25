// フルスクリーンプレビュー：プレビュー canvas を全画面表示し、
// 上部にスタイル編集ツールバー、下部に再生コントロール（シーク／再生／背景切替）を持つ。
// 元は project.tsx 内に定義されていたが、肥大化対策として独立ファイルへ。
//
// 修正ポイント：safePlay は元コードでは未定義参照（pre-existing バグ）だったため、
// props で受け取るように変更。これによりフルスクリーンの再生ボタンが動作するようになる。

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Minus, Plus, AlignLeft, AlignCenter, AlignRight, SlidersHorizontal } from "lucide-react";
import { ColorPicker } from "@/components/color-picker";
import { formatTime } from "@/lib/formatTime";

type Props = {
  sourceCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
  safePlay: () => Promise<void>;
  previewBgMode: "checker" | "color";
  onToggleBgMode: () => void;
  styleProps: {
    fontFamily: string;
    fontSize: number;
    fontColor: string;
    strokeColor: string;
    strokeWidth: number;
    strokeBlur: number;
    textAlign: CanvasTextAlign;
    accentHue: number;
    fonts: string[];
    onChangeFontFamily: (v: string) => void;
    onChangeFontSize: (delta: number) => void;
    onChangeFontColor: (c: string) => void;
    onChangeStrokeColor: (c: string) => void;
    onChangeStrokeWidth: (v: number) => void;
    onChangeStrokeBlur: (v: number) => void;
    onChangeTextAlign: (a: string) => void;
  };
};

export function FullscreenPreview({ sourceCanvasRef, onClose, isPlaying, audioRef, currentTime, duration, seekTo, safePlay, styleProps, previewBgMode, onToggleBgMode }: Props) {
  const fsCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafIdRef = useRef<number>(0);
  const [showControls, setShowControls] = useState(true);
  const [showStylePanel, setShowStylePanel] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  const showStylePanelRef = useRef(false);
  showStylePanelRef.current = showStylePanel;

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (!scrubbingRef.current && !showStylePanelRef.current) {
      hideTimerRef.current = setTimeout(() => {
        if (!showStylePanelRef.current) setShowControls(false);
      }, 3000);
    }
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [resetHideTimer]);

  useEffect(() => {
    if (showStylePanel) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [showStylePanel]);

  useEffect(() => {
    const src = sourceCanvasRef.current;
    const dest = fsCanvasRef.current;
    if (!src || !dest) return;
    const destCtx = dest.getContext("2d");
    if (!destCtx) return;
    let active = true;
    const update = () => {
      if (!active) return;
      dest.width = src.width;
      dest.height = src.height;
      destCtx.drawImage(src, 0, 0);
      rafIdRef.current = requestAnimationFrame(update);
    };
    rafIdRef.current = requestAnimationFrame(update);
    return () => {
      active = false;
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [sourceCanvasRef]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showStylePanel) setShowStylePanel(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, showStylePanel]);

  const updateVisuals = useCallback((pct: number) => {
    const frac = pct / 100;
    if (fillRef.current) fillRef.current.style.width = `calc((100% - 32px) * ${frac})`;
    if (thumbRef.current) thumbRef.current.style.left = `calc(16px + (100% - 32px) * ${frac} - 6px)`;
  }, []);

  useEffect(() => {
    if (!scrubbingRef.current) {
      const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
      updateVisuals(pct);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(currentTime);
    }
  }, [currentTime, duration, updateVisuals]);

  const getSeekRatio = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const pad = 16;
    const usableLeft = rect.left + pad;
    const usableWidth = rect.width - pad * 2;
    if (usableWidth <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - usableLeft) / usableWidth));
  }, []);

  const scrubFromPointer = useCallback((clientX: number) => {
    if (!duration) return;
    const ratio = getSeekRatio(clientX);
    const pct = ratio * 100;
    updateVisuals(pct);
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(ratio * duration);
    seekTo(ratio * duration);
  }, [duration, getSeekRatio, seekTo, updateVisuals]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrubbingRef.current = true;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    trackRef.current?.setPointerCapture(e.pointerId);
    scrubFromPointer(e.clientX);
  }, [scrubFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!scrubbingRef.current) return;
    scrubFromPointer(e.clientX);
  }, [scrubFromPointer]);

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    resetHideTimer();
  }, [resetHideTimer]);

  const accentSolid = "hsl(0 0% 55%)";

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col"
      style={{ backgroundColor: "#000", cursor: showControls ? "default" : "none" }}
      data-testid="fullscreen-overlay"
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
    >
      <div
        className="shrink-0"
        style={{
          backgroundColor: "hsl(0 0% 4% / 0.85)",
          backdropFilter: "blur(12px)",
          opacity: (showControls || showStylePanel) ? 1 : 0,
          transform: (showControls || showStylePanel) ? "translateY(0)" : "translateY(-100%)",
          pointerEvents: (showControls || showStylePanel) ? "auto" : "none",
          transition: "opacity 0.3s, transform 0.3s",
        }}
        onMouseMove={(e) => { if (showStylePanel) e.stopPropagation(); }}
        onClick={(e) => { if (showStylePanel) e.stopPropagation(); }}
      >
        <div
          className="flex items-center gap-3 px-4 overflow-x-auto"
          style={{
            height: showStylePanel ? "44px" : "0px",
            opacity: showStylePanel ? 1 : 0,
            overflow: showStylePanel ? "visible" : "hidden",
            transition: "height 0.25s ease, opacity 0.2s ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: "hsl(0 0% 45%)" }}>Font</span>
            <Select value={styleProps.fontFamily} onValueChange={styleProps.onChangeFontFamily}>
              <SelectTrigger className="h-7 text-xs w-32" data-testid="select-font-fullscreen">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                {styleProps.fonts.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-px h-5 shrink-0" style={{ backgroundColor: "hsl(0 0% 20%)" }} />

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: "hsl(0 0% 45%)" }}>Size</span>
            <Button tabIndex={-1} size="icon" variant="ghost" className="h-6 w-6" onClick={() => styleProps.onChangeFontSize(-4)} data-testid="button-fs-font-size-down">
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-xs font-mono w-8 text-center" data-testid="text-fs-font-size">{styleProps.fontSize}</span>
            <Button tabIndex={-1} size="icon" variant="ghost" className="h-6 w-6" onClick={() => styleProps.onChangeFontSize(4)} data-testid="button-fs-font-size-up">
              <Plus className="w-3 h-3" />
            </Button>
          </div>

          <div className="w-px h-5 shrink-0" style={{ backgroundColor: "hsl(0 0% 20%)" }} />

          <div className="flex items-center gap-0.5 border border-border/50 rounded-md shrink-0">
            <Button tabIndex={-1} size="icon" variant={styleProps.textAlign === "left" ? "secondary" : "ghost"} className="h-6 w-6 rounded-none rounded-l-md" onClick={() => styleProps.onChangeTextAlign("left")} data-testid="button-fs-align-left">
              <AlignLeft className="w-3 h-3" />
            </Button>
            <Button tabIndex={-1} size="icon" variant={styleProps.textAlign === "center" ? "secondary" : "ghost"} className="h-6 w-6 rounded-none" onClick={() => styleProps.onChangeTextAlign("center")} data-testid="button-fs-align-center">
              <AlignCenter className="w-3 h-3" />
            </Button>
            <Button tabIndex={-1} size="icon" variant={styleProps.textAlign === "right" ? "secondary" : "ghost"} className="h-6 w-6 rounded-none rounded-r-md" onClick={() => styleProps.onChangeTextAlign("right")} data-testid="button-fs-align-right">
              <AlignRight className="w-3 h-3" />
            </Button>
          </div>

          <div className="w-px h-5 shrink-0" style={{ backgroundColor: "hsl(0 0% 20%)" }} />

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: "hsl(0 0% 45%)" }}>Color</span>
            <ColorPicker value={styleProps.fontColor} onChange={styleProps.onChangeFontColor} size={24} testId="picker-fs-font-color" />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: "hsl(0 0% 45%)" }}>Stroke</span>
            <ColorPicker
              value={styleProps.strokeColor}
              onChange={(c) => {
                styleProps.onChangeStrokeColor(c);
                if (styleProps.strokeWidth === 0) styleProps.onChangeStrokeWidth(8);
              }}
              onClear={() => styleProps.onChangeStrokeWidth(0)}
              disabled={styleProps.strokeWidth === 0}
              size={24}
              testId="picker-fs-stroke-color"
            />
          </div>

          <div className="w-px h-5 shrink-0" style={{ backgroundColor: "hsl(0 0% 20%)" }} />

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-bold font-mono" style={{ color: "hsl(0 0% 50%)" }}>W</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={styleProps.strokeWidth}
              onChange={(e) => styleProps.onChangeStrokeWidth(Number(e.target.value))}
              className="timeline-zoom-slider w-16"
              tabIndex={-1}
              data-testid="slider-fs-stroke-width"
            />
            <span className="text-[10px] font-mono font-bold" style={{ color: "hsl(0 0% 60%)" }}>{styleProps.strokeWidth}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-bold font-mono tracking-wider" style={{ color: "hsl(0 0% 50%)" }}>BLUR</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={styleProps.strokeBlur}
              onChange={(e) => styleProps.onChangeStrokeBlur(Number(e.target.value))}
              className="timeline-zoom-slider w-16"
              tabIndex={-1}
              data-testid="slider-fs-stroke-blur"
            />
            <span className="text-[10px] font-mono font-bold" style={{ color: "hsl(0 0% 60%)" }}>{styleProps.strokeBlur}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        <canvas ref={fsCanvasRef} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div
        className="shrink-0 flex flex-col"
        style={{
          backgroundColor: "hsl(0 0% 4% / 0.85)",
          backdropFilter: "blur(12px)",
          opacity: showControls ? 1 : 0,
          transform: showControls ? "translateY(0)" : "translateY(100%)",
          pointerEvents: showControls ? "auto" : "none",
          transition: "opacity 0.3s, transform 0.3s",
        }}
      >
        <div
          ref={trackRef}
          className="relative w-full flex items-center group cursor-pointer"
          style={{ height: "20px", padding: "0 16px", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          data-testid="slider-fullscreen-seek"
        >
          <div className="absolute h-[3px] rounded-full" style={{ backgroundColor: "hsl(48 30% 18%)", left: "16px", right: "16px", top: "50%", transform: "translateY(-50%)" }} />
          <div
            ref={fillRef}
            className="absolute h-[3px] rounded-full"
            style={{ backgroundColor: "hsl(48 100% 50%)", left: "16px", width: "0px", top: "50%", transform: "translateY(-50%)" }}
          />
          <div
            ref={thumbRef}
            className="absolute rounded-full group-hover:scale-125"
            style={{
              width: "12px",
              height: "12px",
              backgroundColor: "hsl(48 100% 55%)",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              boxShadow: "0 0 6px hsl(48 100% 50% / 0.5)",
              willChange: "left",
            }}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              style={{ color: "hsl(0 0% 90%)" }}
              onClick={() => { if (audioRef.current) { if (isPlaying) audioRef.current.pause(); else safePlay().catch(() => {}); } }}
              data-testid="button-fullscreen-play"
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1" /><rect x="9" y="2" width="4" height="12" rx="1" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l10-5.5z" /></svg>
              )}
            </button>
            <span ref={timeDisplayRef} className="text-xs font-mono tabular-nums" style={{ color: "hsl(0 0% 55%)" }}>
              {formatTime(currentTime)}
            </span>
            <span className="text-[10px]" style={{ color: "hsl(0 0% 35%)" }}>/</span>
            <span className="text-xs font-mono tabular-nums" style={{ color: "hsl(0 0% 40%)" }}>
              {formatTime(duration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              style={{ color: showStylePanel ? accentSolid : "hsl(0 0% 60%)" }}
              onClick={(e) => { e.stopPropagation(); setShowStylePanel(prev => !prev); }}
              data-testid="button-fullscreen-style-toggle"
              title="スタイル設定"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              style={{
                color: previewBgMode === "color" ? accentSolid : "hsl(0 0% 60%)",
              }}
              onClick={(e) => { e.stopPropagation(); onToggleBgMode(); }}
              data-testid="button-fullscreen-bg-toggle"
              title={previewBgMode === "checker" ? "背景をテーマカラーに" : "背景をチェッカーに"}
            >
              <div
                className="w-4 h-4 rounded-sm border"
                style={{
                  backgroundColor: "hsl(0 0% 35%)",
                  borderColor: previewBgMode === "color" ? accentSolid : "hsl(0 0% 50%)",
                }}
              />
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded hover:bg-white/10"
              style={{ color: "hsl(0 0% 60%)" }}
              onClick={onClose}
              data-testid="button-fullscreen-exit"
            >
              ESC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
