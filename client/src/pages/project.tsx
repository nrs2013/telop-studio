import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from "react";

interface PresetConfig {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  strokeColor: string;
  strokeWidth: number;
  strokeBlur: number;
  textAlign: string;
  textX: number | null;
  textY: number | null;
  demoLineY: number;
  creditFontWeight: string;
  creditFontSize: number;
  creditTitleFontSize: number;
  creditInfoFontSize: number;
  creditRightTitleFontSize: number;
  creditBaseXRatio: number;
  creditRightMarginRatio: number;
  creditCharDelay: number;
  creditCharAnimDur: number;
  creditRightCharDelay: number;
  creditRightCharAnimDur: number;
}

const SAKURA_HINATA_CREDIT = {
  creditTitleFontSize: 64,
  creditInfoFontSize: 36,
  creditRightTitleFontSize: 38,
  creditBaseXRatio: 0.04,
  creditRightMarginRatio: 0.02,
  creditCharDelay: 100,
  creditCharAnimDur: 800,
  creditRightCharDelay: 100,
  creditRightCharAnimDur: 500,
};

const CUSTOM_PRESETS_KEY = "telop-studio-custom-presets";

function loadCustomPresets(): Record<string, Partial<PresetConfig>> {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCustomPreset(name: string, config: PresetConfig) {
  const custom = loadCustomPresets();
  custom[name] = config;
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(custom));
}

function resetCustomPreset(name: string) {
  const custom = loadCustomPresets();
  delete custom[name];
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(custom));
}

const DEFAULT_PRESETS: Record<string, PresetConfig> = {
  sakurazaka: {
    fontFamily: "Noto Serif JP",
    fontSize: 72,
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 2,
    strokeBlur: 8,
    textAlign: "left",
    textX: 44,
    textY: 1013,
    demoLineY: 88,
    creditFontWeight: "bold",
    creditFontSize: 36,
    ...SAKURA_HINATA_CREDIT,
  },
  hinatazaka: {
    fontFamily: "Inter",
    fontSize: 72,
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 2,
    strokeBlur: 8,
    textAlign: "left",
    textX: 44,
    textY: 1013,
    demoLineY: 88,
    creditFontWeight: "bold",
    creditFontSize: 36,
    ...SAKURA_HINATA_CREDIT,
  },
  other: {
    fontFamily: "Noto Sans JP",
    fontSize: 72,
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 2,
    strokeBlur: 8,
    textAlign: "center",
    textX: null,
    textY: null,
    demoLineY: 80,
    creditFontWeight: "bold",
    creditFontSize: 36,
    creditTitleFontSize: 64,
    creditInfoFontSize: 36,
    creditRightTitleFontSize: 38,
    creditBaseXRatio: 0.04,
    creditRightMarginRatio: 0.02,
    creditCharDelay: 100,
    creditCharAnimDur: 800,
    creditRightCharDelay: 100,
    creditRightCharAnimDur: 500,
  },
};

function getPresets(): Record<string, PresetConfig> {
  const custom = loadCustomPresets();
  const result: Record<string, PresetConfig> = {};
  for (const [k, v] of Object.entries(DEFAULT_PRESETS)) {
    result[k] = custom[k] ? { ...v, ...custom[k] } as PresetConfig : v;
  }
  return result;
}

import { storage } from "@/lib/storage";
import { projectUndoManager, useUndo } from "@/lib/undoManager";
import { fetchDropbox } from "@/lib/dropbox-auto-reconnect";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Upload,
  Pause,
  Square,
  Circle,
  SkipForward,
  Download,
  Settings,
  Music,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Plus,
  FileText,
  Package,
  Pencil,
  GripVertical,
  Save,
  RotateCcw,
  Cloud,
  RefreshCw,
  Copy,
  Maximize,
  Minimize,
  GripHorizontal,
  SlidersHorizontal,
  Keyboard,
  HardDrive,
  Link2,
  Unlink2,
} from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import { drawTextWithRuby } from "@/lib/rubyParser";
import { TimelineEditor } from "@/components/timeline-editor";
import { syncService } from "@/lib/syncService";
import { ExportDialog } from "@/components/export-dialog";
import { StyleSettings } from "@/components/style-settings";
import { MetadataDialog } from "@/components/metadata-dialog";
import { DropboxPicker } from "@/components/dropbox-picker";
import { ColorPicker } from "@/components/color-picker";
import type { Project, LyricLine } from "@shared/schema";

function FullscreenPreview({ sourceCanvasRef, onClose, isPlaying, audioRef, currentTime, duration, seekTo, styleProps, previewBgMode, onToggleBgMode }: {
  sourceCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
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
}) {
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

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
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

function FullscreenLyricsEditor({ lyricsText, onLyricsChange, lyrics, activeLyricIndex: activeDisplayIndex, accentHue, audioRef, isPlaying, currentTime, duration, seekTo, onClose }: {
  lyricsText: string;
  onLyricsChange: (text: string) => void;
  lyrics: LyricLine[] | null;
  activeLyricIndex: number;
  accentHue: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const scrubbingRef = useRef(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  useEffect(() => {
    if (!scrubbingRef.current) {
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(currentTime);
    }
  }, [currentTime, pct]);

  const scrubFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || !duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const p = ratio * 100;
    if (fillRef.current) fillRef.current.style.width = `${p}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${p}%`;
    if (timeRef.current) timeRef.current.textContent = formatTime(ratio * duration);
    if (audioRef.current) audioRef.current.currentTime = ratio * duration;
  }, [duration, audioRef]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    scrubbingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrubFromPointer(e.clientX);
  }, [scrubFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!scrubbingRef.current) return;
    scrubFromPointer(e.clientX);
  }, [scrubFromPointer]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    const track = trackRef.current;
    if (track && duration) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(ratio * duration);
    }
  }, [duration, seekTo]);

  const handleScroll = () => {
    if (textareaRef.current) {
      const st = textareaRef.current.scrollTop;
      if (gutterRef.current) gutterRef.current.scrollTop = st;
      setScrollTop(st);
    }
  };

  const lines = lyricsText.split("\n");
  const lineH = 28;
  const accentSolid = "hsl(0 0% 55%)";

  return (
    <div className="fixed inset-0 z-[85] flex flex-col" style={{ backgroundColor: "hsl(0 0% 5%)" }} data-testid="fullscreen-lyrics-overlay">
      <div className="shrink-0 flex items-center justify-between px-5 py-2" style={{ borderBottom: "1px solid hsl(0 0% 22%)" }}>
        <div className="flex items-center gap-3">
          <Type style={{ width: 14, height: 14, color: "hsl(48 100% 50%)" }} />
          <span className="text-xs font-bold tracking-wider uppercase" style={{ color: "hsl(48 100% 50%)" }}>
            Lyrics Editor
          </span>
          <span className="text-[10px] font-mono" style={{ color: "hsl(0 0% 45%)" }}>
            {lines.length} lines
          </span>
        </div>
        <button
          className="text-xs px-3 py-1.5 rounded hover:bg-white/10"
          style={{ color: "hsl(0 0% 60%)" }}
          onClick={onClose}
          data-testid="button-lyrics-fullscreen-close"
        >
          ESC
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
        <div
          ref={gutterRef}
          className="shrink-0 select-none overflow-hidden py-3"
          style={{ borderRight: "1px solid hsl(0 0% 22%)", width: "52px", overflowY: "hidden" }}
        >
          {lines.map((lineText, i) => {
            const isBlank = lineText.trim() === "";
            const isActive = i === activeDisplayIndex;
            return (
              <div
                key={i}
                className="flex items-center justify-end gap-1 pr-2"
                style={{
                  height: `${lineH}px`,
                  lineHeight: `${lineH}px`,
                  fontSize: "11px",
                  fontFamily: "monospace",
                  backgroundColor: isActive ? "hsla(48, 60%, 18%, 0.5)" : "transparent",
                  borderLeft: isActive ? "2px solid hsl(48 100% 50%)" : "2px solid transparent",
                }}
              >
                <span style={{
                  color: isActive ? "hsl(48 100% 55%)" : isBlank ? "hsl(0 55% 55%)" : "hsl(0 0% 40%)",
                  fontWeight: isActive ? 700 : 400,
                }}>
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex-1 relative overflow-hidden">
          <textarea
            ref={textareaRef}
            value={lyricsText}
            onChange={(e) => onLyricsChange(e.target.value)}
            onScroll={handleScroll}
            className="w-full h-full resize-none border-0 outline-none focus:ring-0 text-sm"
            style={{
              lineHeight: `${lineH}px`,
              padding: "12px 20px",
              backgroundColor: "transparent",
              color: "hsl(0 0% 82%)",
              fontFamily: "'Noto Sans JP', sans-serif",
              caretColor: "hsl(0 0% 65%)",
            }}
            placeholder={"歌詞を入力またはファイルから読み込み\n（1行ずつ入力してください）\n\n空行はブランク（間奏）として扱われます"}
            data-testid="textarea-lyrics-fullscreen"
          />
          <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ padding: "12px 20px" }}>
            {activeDisplayIndex >= 0 && (() => {
              const top = activeDisplayIndex * lineH - scrollTop;
              if (top >= -lineH && top <= 2000) {
                return (
                  <div
                    className="absolute"
                    style={{
                      top: `${top + 12}px`,
                      left: 0,
                      right: 0,
                      height: `${lineH}px`,
                      backgroundColor: "hsla(48, 60%, 18%, 0.5)",
                      borderRight: "2px solid hsl(48 100% 50%)",
                    }}
                  />
                );
              }
              return null;
            })()}
            {lines.map((line, i) => {
              if (line.trim() !== "") return null;
              const top = i * lineH - scrollTop;
              if (top < -lineH || top > 2000) return null;
              return (
                <div
                  key={i}
                  className="absolute flex items-center"
                  style={{
                    top: `${top + 12}px`,
                    left: "20px",
                    right: "20px",
                    height: `${lineH}px`,
                  }}
                >
                  <span className="text-[10px] font-mono uppercase" style={{ color: "hsl(0 0% 20%)", opacity: 0.5 }}>
                    ── blank ──
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="shrink-0" style={{ borderTop: "1px solid hsl(0 0% 22%)", backgroundColor: "hsl(0 0% 5%)" }}>
        <div
          ref={trackRef}
          className="relative w-full flex items-center group cursor-pointer"
          style={{ height: "16px", padding: "0 20px", touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          data-testid="slider-lyrics-fullscreen-seek"
        >
          <div className="absolute h-[2px] rounded-full" style={{ backgroundColor: "hsl(48 30% 18%)", left: "20px", right: "20px", top: "50%", transform: "translateY(-50%)" }} />
          <div
            ref={fillRef}
            className="absolute h-[2px] rounded-full"
            style={{ backgroundColor: "hsl(48 100% 50%)", left: "20px", width: "0%", maxWidth: "calc(100% - 40px)", top: "50%", transform: "translateY(-50%)" }}
          />
          <div
            ref={thumbRef}
            className="absolute rounded-full group-hover:scale-125"
            style={{
              width: "10px",
              height: "10px",
              backgroundColor: "hsl(48 100% 55%)",
              left: "0%",
              marginLeft: "15px",
              top: "50%",
              transform: "translateY(-50%)",
              boxShadow: "0 0 4px hsl(48 100% 50% / 0.4)",
              willChange: "left",
            }}
          />
        </div>
        <div className="flex items-center gap-3 px-5 pb-2">
          <button
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10"
            style={{ color: "hsl(0 0% 80%)" }}
            onClick={() => { if (audioRef.current) { if (isPlaying) audioRef.current.pause(); else safePlay().catch(() => {}); } }}
            data-testid="button-lyrics-fullscreen-play"
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12" rx="1" /><rect x="9" y="2" width="4" height="12" rx="1" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l10-5.5z" /></svg>
            )}
          </button>
          <span ref={timeRef} className="text-[11px] font-mono tabular-nums" style={{ color: "hsl(0 0% 50%)" }}>
            {formatTime(currentTime)}
          </span>
          <span className="text-[10px]" style={{ color: "hsl(0 0% 30%)" }}>/</span>
          <span className="text-[11px] font-mono tabular-nums" style={{ color: "hsl(0 0% 35%)" }}>
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

async function extractTextFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt")) {
    const text = await file.text();
    return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  }

  if (name.endsWith(".docx")) {
    const JSZip = (await import("jszip")).default;
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) throw new Error("Word文書のXMLが見つかりません");

    const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, "application/xml");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    function extractRunText(el: Element): string {
      let text = "";
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType !== 1) continue;
        const tag = (child as Element).localName;
        if (tag === "t") {
          text += (child as Element).textContent || "";
        } else if (tag === "br") {
          text += "\n";
        } else if (tag === "tab") {
          text += "\t";
        }
      }
      return text;
    }

    function processParagraph(pEl: Element): string {
      let line = "";
      for (const child of Array.from(pEl.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        const tag = el.localName;

        if (tag === "r") {
          line += extractRunText(el);
        } else if (tag === "ruby") {
          const rtEl = el.getElementsByTagNameNS(ns, "rt")[0];
          const rubyBaseEl = el.getElementsByTagNameNS(ns, "rubyBase")[0];
          let baseText = "";
          let rubyText = "";
          if (rubyBaseEl) {
            for (const r of Array.from(rubyBaseEl.getElementsByTagNameNS(ns, "r"))) {
              baseText += extractRunText(r);
            }
          }
          if (rtEl) {
            for (const r of Array.from(rtEl.getElementsByTagNameNS(ns, "r"))) {
              rubyText += extractRunText(r);
            }
          }
          if (baseText && rubyText) {
            const allKanji = [...baseText].every(ch => KANJI_RE.test(ch));
            if (allKanji) {
              line += `${baseText}{${rubyText}}`;
            } else {
              line += `[${baseText}]{${rubyText}}`;
            }
          } else {
            line += baseText;
          }
        } else if (tag === "hyperlink" || tag === "smartTag") {
          line += processParagraph(el);
        }
      }
      return line;
    }

    const paragraphs = xmlDoc.getElementsByTagNameNS(ns, "p");
    const lines: string[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const pText = processParagraph(paragraphs[i]);
      const subLines = pText.split("\n");
      for (const sub of subLines) {
        const trimmed = sub.trim();
        if (trimmed.length > 0) lines.push(trimmed);
      }
    }
    return lines;
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { cellStyles: true, cellHTML: true });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const rowTexts: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          if (!cell) continue;
          let val = "";
          if (cell.h) {
            const tmp = document.createElement("div");
            tmp.innerHTML = cell.h;
            val = tmp.textContent || "";
          } else if (cell.w) {
            val = cell.w;
          } else if (cell.v != null) {
            val = String(cell.v);
          }
          if (val.trim()) rowTexts.push(val.trim());
        }
        if (rowTexts.length > 0) {
          const rowText = rowTexts.join(" ");
          const subLines = rowText.split(/\r?\n/);
          for (const sub of subLines) {
            const trimmed = sub.trim();
            if (trimmed.length > 0) lines.push(trimmed);
          }
        }
      }
    }
    return lines;
  }

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    const pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const lines: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as any[];
      if (items.length === 0) continue;

      const sorted = [...items].filter(it => it.str != null).sort((a, b) => {
        const ya = a.transform?.[5] ?? 0;
        const yb = b.transform?.[5] ?? 0;
        if (Math.abs(ya - yb) > 3) return yb - ya;
        const xa = a.transform?.[4] ?? 0;
        const xb = b.transform?.[4] ?? 0;
        return xa - xb;
      });

      let currentLine = "";
      let lastY: number | null = null;
      let lastRight = 0;

      for (const item of sorted) {
        const y = item.transform?.[5] ?? 0;
        const x = item.transform?.[4] ?? 0;
        const text = item.str ?? "";

        if (lastY !== null && Math.abs(y - lastY) > 3) {
          const trimmed = currentLine.trim();
          if (trimmed.length > 0) lines.push(trimmed);
          currentLine = text;
        } else {
          const gap = lastRight > 0 ? x - lastRight : 0;
          if (gap > 5 && currentLine.length > 0 && !currentLine.endsWith(" ")) {
            currentLine += " ";
          }
          currentLine += text;
        }
        lastY = y;
        lastRight = x + (item.width ?? 0);
      }
      const trimmed = currentLine.trim();
      if (trimmed.length > 0) lines.push(trimmed);
    }
    return lines;
  }

  throw new Error(`未対応のファイル形式です`);
}

const DISPLAY_COLORS = [
  { bg: "hsla(0, 0%, 13%, 0.9)", border: "hsl(0, 0%, 32%)" },
  { bg: "hsla(0, 0%, 12%, 0.9)", border: "hsl(0, 0%, 30%)" },
  { bg: "hsla(0, 0%, 11%, 0.9)", border: "hsl(0, 0%, 29%)" },
  { bg: "hsla(0, 0%, 13%, 0.9)", border: "hsl(0, 0%, 31%)" },
  { bg: "hsla(0, 0%, 12%, 0.9)", border: "hsl(0, 0%, 30%)" },
  { bg: "hsla(0, 0%, 11%, 0.9)", border: "hsl(0, 0%, 28%)" },
];

const FONTS = [
  "Noto Sans JP",
  "Noto Serif JP",
  "Shippori Mincho",
  "Zen Old Mincho",
  "Zen Kaku Gothic New",
  "Kaisei Decol",
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Source Serif 4",
];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { undo, redo, canUndo, canRedo, push: pushUndo, clear: clearUndo, undoDescription, redoDescription } = useUndo(projectUndoManager);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);

  const defaultKeyMap: Record<string, string> = useMemo(() => ({
    playPause: "Space",
    seekStart: "KeyW",
    zoomOut: "KeyA",
    zoomIn: "KeyD",
    seekBack: "KeyQ",
    seekForward: "KeyE",
    marker: "KeyS",
    fadeMode: "KeyF",
    fullscreen: "Digit1",
    titleIn: "KeyT",
    title2In: "KeyY",
  }), []);

  const [customKeyMap, setCustomKeyMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("telop-shortcuts");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  const keyMapRef = useRef<Record<string, string>>({});
  const resolvedKeyMap = useMemo(() => {
    const merged = { ...defaultKeyMap, ...customKeyMap };
    keyMapRef.current = merged;
    return merged;
  }, [defaultKeyMap, customKeyMap]);

  const updateShortcut = useCallback((action: string, code: string) => {
    setCustomKeyMap(prev => {
      const next = { ...prev, [action]: code };
      localStorage.setItem("telop-shortcuts", JSON.stringify(next));
      return next;
    });
    setEditingShortcut(null);
  }, []);

  const resetShortcuts = useCallback(() => {
    setCustomKeyMap({});
    localStorage.removeItem("telop-shortcuts");
    setEditingShortcut(null);
  }, []);

  const codeToLabel = useCallback((code: string): string => {
    if (code === "Space") return "Space";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code === "Semicolon") return ";";
    if (code === "Comma") return ",";
    if (code === "Period") return ".";
    if (code === "Slash") return "/";
    if (code === "BracketLeft") return "[";
    if (code === "BracketRight") return "]";
    if (code === "Backquote") return "`";
    if (code === "Minus") return "-";
    if (code === "Equal") return "=";
    return code;
  }, []);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsProcessing, setSaveAsProcessing] = useState(false);

  useEffect(() => {
    if (!id) return;
    const sendHeartbeat = () => {
      fetch("/api/editing/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      }).catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 15_000);
    return () => {
      clearInterval(interval);
      fetch("/api/editing/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      }).catch(() => {});
    };
  }, [id]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeRef = useRef(1.0);
  const ensureVolume = useCallback(() => {
    const a = audioRef.current;
    if (a) a.volume = volumeRef.current;
  }, []);
  const safePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return Promise.reject(new Error("no audio"));
    a.volume = volumeRef.current;
    return a.play();
  }, []);
  const audioRefCallback = useCallback((el: HTMLAudioElement | null) => {
    (audioRef as React.MutableRefObject<HTMLAudioElement | null>).current = el;
    if (el) el.volume = volumeRef.current;
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformEndTime, setWaveformEndTime] = useState<number | null>(null);
  const waveformEndTimeRef = useRef<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioArrayBuffer, setAudioArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string; fileName: string; createdAt: string; dropboxPath?: string }[]>([]);
  const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);
  const [dropboxUploading, setDropboxUploading] = useState(false);
  const [dropboxDuplicateDialog, setDropboxDuplicateDialog] = useState<{
    fileName: string;
    suggestedName: string;
    formData: FormData;
    trackId: string;
  } | null>(null);
  const [dropboxOAuthDialogOpen, setDropboxOAuthDialogOpen] = useState(false);
  const [dropboxOAuthStatus, setDropboxOAuthStatus] = useState<{ customConfigured: boolean; customConnected: boolean } | null>(null);
  const [dropboxOAuthConnecting, setDropboxOAuthConnecting] = useState(false);
  const [audioRetryKey, setAudioRetryKey] = useState(0);

  const [lyricsText, setLyricsText] = useState("");
  const [lyricsTextDirty, setLyricsTextDirty] = useState(false);
  const [lyricsScrollTop, setLyricsScrollTop] = useState(0);
  const [lyricsInitialized, setLyricsInitialized] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricsTextRef = useRef("");

  const [projectSyncing, setProjectSyncing] = useState(false);

  const handleProjectSync = useCallback(async () => {
    if (!id) return;
    setProjectSyncing(true);
    try {
      await syncService.autoLogin();
      const result = await syncService.pushProject(id);
      if (result.success) {
        toast({ title: "同期完了 (version " + result.version + ")" });
      } else {
        toast({ title: result.message || "同期失敗", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "同期エラー: " + (err.message || ""), variant: "destructive" });
    } finally {
      setProjectSyncing(false);
    }
  }, [id, toast]);

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const [creditDragActive, setCreditDragActive] = useState(false);
  const creditDragCleanupRef = useRef<(() => void) | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [recordingIndex, setRecordingIndex] = useState(-1);
  const [recordingTimings, setRecordingTimings] = useState<{ id: string; startTime: number | null; endTime: number | null }[]>([]);
  const [checkMarkers, setCheckMarkers] = useState<{ id: string; time: number }[]>([]);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lyricsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingScrollRef = useRef<HTMLDivElement>(null);

  const [fontLoaded, setFontLoaded] = useState(0);
  const demoLineYRef = useRef(80);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | undefined>();
  const [projectLoading, setProjectLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    clearUndo();
    setProjectLoading(true);
    storage.getProject(id).then(async (p) => {
      setProject(p);
      setProjectLoading(false);
    });
    syncService.autoLogin().then(() => {
      const reloadAfterSync = async () => {
        if (isRecordingRef.current) {
          console.log("[ProjectSync] Skipping reload during recording");
          return;
        }
        if (syncService.isDirty(id)) {
          console.log("[ProjectSync] Skipping reload for dirty project:", id);
          return;
        }
        console.log("[ProjectSync] Reloading data after sync");
        const p = await storage.getProject(id);
        if (p) setProject(p);
        await loadLyrics();
        const tracks = await storage.getAudioTracks(id);
        setAudioTracks(tracks);
      };
      syncService.autoSyncOnOpen((result) => {
        if (result.added > 0 || result.updated > 0) reloadAfterSync();
      });
      syncService.startAutoSync(reloadAfterSync);
    });
    return () => {
      syncService.flushScheduledPush();
      syncService.stopAutoSync();
    };
  }, [id]);

  const [lyrics, setLyrics] = useState<LyricLine[] | undefined>();

  const loadLyrics = useCallback(async () => {
    if (!id) return;
    const lines = await storage.getLyricLines(id);
    const timed = lines.filter(l => l.startTime !== null);
    const untimed = lines.filter(l => l.startTime === null);
    const sorted = [...timed].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const finalOrder = [...sorted, ...untimed];

    const GAP_THRESHOLD = 0.1;
    const orderUpdates: { id: string; lineIndex: number; blankBefore: boolean }[] = [];
    let needsUpdate = false;

    for (let i = 0; i < finalOrder.length; i++) {
      const cur = finalOrder[i];
      let hasGap = false;
      if (i > 0 && cur.startTime !== null) {
        const prev = finalOrder[i - 1];
        if (prev.endTime !== null && cur.startTime !== null) {
          hasGap = (cur.startTime - prev.endTime) > GAP_THRESHOLD;
        }
      }
      if (cur.lineIndex !== i || !!cur.blankBefore !== hasGap) {
        needsUpdate = true;
      }
      orderUpdates.push({ id: cur.id, lineIndex: i, blankBefore: hasGap });
    }

    if (needsUpdate) {
      const reordered = orderUpdates.map(u => {
        const orig = finalOrder.find(l => l.id === u.id)!;
        return { ...orig, lineIndex: u.lineIndex, blankBefore: u.blankBefore };
      });
      setLyrics(reordered);
      await storage.updateLyricOrder(orderUpdates);
      
    } else {
      setLyrics(finalOrder);
    }
  }, [id]);

  useEffect(() => {
    loadLyrics();
  }, [loadLyrics]);

  const markersLoadedRef = useRef(false);
  const markersProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id) return;
    markersLoadedRef.current = false;
    markersProjectRef.current = id;
    storage.getCheckMarkers(id).then(m => {
      if (markersProjectRef.current !== id) return;
      setCheckMarkers(m.map(mk => ({ id: mk.id, time: mk.time })));
      markersLoadedRef.current = true;
    });
    return () => { markersLoadedRef.current = false; };
  }, [id]);

  const prevMarkersRef = useRef<string>("");
  useEffect(() => {
    if (!id || !markersLoadedRef.current) return;
    const key = JSON.stringify(checkMarkers.map(m => `${m.id}:${m.time}`));
    if (key === prevMarkersRef.current) return;
    prevMarkersRef.current = key;
    storage.setCheckMarkers(id, checkMarkers);
    
  }, [checkMarkers, id]);

  const lyricsToText = useCallback((lines: LyricLine[]) => {
    const parts: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && lines[i].blankBefore) {
        parts.push("");
      }
      parts.push(lines[i].text);
    }
    return parts.join("\n");
  }, []);

  useEffect(() => {
    if (lyrics && !lyricsInitialized) {
      const t = lyricsToText(lyrics);
      setLyricsText(t);
      lyricsTextRef.current = t;
      lastSyncedTextRef.current = t;
      setLyricsInitialized(true);
      setLyricsTextDirty(false);
    }
  }, [lyrics, lyricsInitialized, lyricsToText]);

  const lastSyncedTextRef = useRef("");
  useEffect(() => {
    if (lyrics && lyricsInitialized && !lyricsTextDirty) {
      const t = lyricsToText(lyrics);
      if (t !== lastSyncedTextRef.current) {
        setLyricsText(t);
        lyricsTextRef.current = t;
        lastSyncedTextRef.current = t;
      }
    }
  }, [lyrics, lyricsToText, lyricsTextDirty]);

  const updateProjectDataRef = useRef<(data: Partial<Project>) => void>(() => {});

  const handleWaveformEndDetected = useCallback((endTime: number) => {
    setWaveformEndTime(endTime);
    waveformEndTimeRef.current = endTime;
  }, []);

  useEffect(() => {
    if (!audioUrl) {
      setWaveformEndTime(null);
      waveformEndTimeRef.current = null;
    }
    ensureVolume();
  }, [audioUrl]);

  const snapTimeToBeat = useCallback((t: number) => {
    const bpmVal = timelineBpmRef.current || projectRef.current?.detectedBpm;
    const offset = projectRef.current?.bpmGridOffset ?? 0;
    if (bpmVal && bpmVal > 0) {
      const beatInterval = 60 / bpmVal;
      const step = Math.round((t - offset) / beatInterval);
      let snapped = step * beatInterval + offset;
      if (snapped < 0) snapped = 0;
      return snapped;
    }
    return t;
  }, []);

  const calcCreditOutTime = useCallback((dur: number, animDurMs: number = 6700) => {
    const animScale = animDurMs / 6700;
    const outEffectDurSec = 1.5 * animScale;
    const effectiveDur = waveformEndTimeRef.current ?? dur;
    const bpmVal = timelineBpmRef.current || projectRef.current?.detectedBpm;
    const offset = projectRef.current?.bpmGridOffset ?? 0;
    if (bpmVal && bpmVal > 0) {
      const beatInterval = 60 / bpmVal;
      const stepAtEnd = Math.round((effectiveDur - offset) / beatInterval);
      let snappedEnd = stepAtEnd * beatInterval + offset;
      if (snappedEnd < 0) snappedEnd = 0;
      const creditOut = Math.max(0, snappedEnd - outEffectDurSec);
      return creditOut;
    }
    return Math.max(0, effectiveDur - outEffectDurSec);
  }, []);

  const startCreditDrag = useCallback(() => {
    if (duration <= 0) return;
    if (creditDragCleanupRef.current) creditDragCleanupRef.current();
    setCreditDragActive(true);
    document.body.style.cursor = "grabbing";
    const ghost = document.createElement("div");
    ghost.id = "credit-drag-ghost";
    ghost.style.cssText = "position:fixed;pointer-events:none;z-index:9999;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:bold;letter-spacing:0.05em;color:hsl(0,0%,68%);background:hsla(0,0%,14%,0.9);border:1px solid hsl(0,0%,35%);box-shadow:0 2px 8px rgba(0,0,0,0.4);display:none;";
    const layoutLabel = (projectRef.current?.creditTitleLayout ?? 1) === 2 ? "TB" : "TA";
    ghost.textContent = `${layoutLabel} IN`;
    document.body.appendChild(ghost);
    const onMove = (e: MouseEvent) => {
      ghost.style.display = "block";
      ghost.style.left = `${e.clientX + 12}px`;
      ghost.style.top = `${e.clientY + 12}px`;
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      ghost.remove();
      setCreditDragActive(false);
      creditDragCleanupRef.current = null;
    };
    const onUp = (e: MouseEvent) => {
      cleanup();
      const tlEl = document.querySelector("[data-testid='area-timeline-blocks']") as HTMLElement | null;
      if (!tlEl) return;
      const rect = tlEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const pps = parseFloat(tlEl.dataset.pps || "50");
        const dur = parseFloat(tlEl.dataset.duration || "0");
        if (dur <= 0) return;
        const scrollLeft = tlEl.scrollLeft;
        const x = e.clientX - rect.left + scrollLeft;
        let dropTime = Math.max(0, Math.min(dur, x / pps));
        dropTime = snapToGrid(dropTime);
        const bpm = timelineBpmRef.current || projectRef.current?.detectedBpm;
        const beatMs = bpm && bpm > 0 ? (60 / bpm) * 1000 : null;
        const baseAnimDur = beatMs ? beatMs * 16 : 6700;
        const defaultWipeMs = beatMs ? beatMs * 12 : baseAnimDur * 3 / 4;
        const outTime = calcCreditOutTime(dur, baseAnimDur);
        updateProjectDataRef.current({ creditInTime: dropTime, creditOutTime: outTime, creditAnimDuration: baseAnimDur, creditWipeStartMs: defaultWipeMs, creditTitleLayout: projectRef.current?.creditTitleLayout ?? 1 } as any);
      }
    };
    creditDragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [duration, calcCreditOutTime]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (creditDragCleanupRef.current) creditDragCleanupRef.current();
    };
  }, []);

  const editedLyrics = useMemo(() => {
    if (!lyricsTextDirty || !lyrics) return null;
    const rawLines = lyricsText.split("\n");

    const contentLines: { text: string; blankBefore: boolean }[] = [];
    let pendingBlank = false;
    for (const raw of rawLines) {
      if (raw.trim() === "") {
        pendingBlank = true;
      } else {
        contentLines.push({ text: raw, blankBefore: pendingBlank });
        pendingBlank = false;
      }
    }

    const oldByText = new Map<string, LyricLine[]>();
    for (const l of lyrics) {
      if (!oldByText.has(l.text)) oldByText.set(l.text, []);
      oldByText.get(l.text)!.push(l);
    }
    const usedIds = new Set<string>();

    const result: LyricLine[] = contentLines.map((cl, i) => {
      const original = lyrics[i];
      if (original && original.text === cl.text && !usedIds.has(original.id)) {
        usedIds.add(original.id);
        return { ...original, lineIndex: i, blankBefore: cl.blankBefore };
      }
      const candidates = oldByText.get(cl.text);
      if (candidates) {
        const found = candidates.find((c) => !usedIds.has(c.id));
        if (found) {
          usedIds.add(found.id);
          return { ...found, lineIndex: i, blankBefore: cl.blankBefore };
        }
      }
      return {
        id: `temp-${i}`,
        projectId: id!,
        lineIndex: i,
        text: cl.text,
        startTime: null as number | null,
        endTime: null as number | null,
        fadeIn: 0,
        fadeOut: 0,
        fontSize: null,
        blankBefore: cl.blankBefore,
      };
    });

    for (const old of lyrics) {
      if (usedIds.has(old.id)) continue;
      if (old.startTime === null && old.endTime === null) continue;
      for (let i = 0; i < result.length - 1; i++) {
        if (result[i].startTime !== null || result[i + 1].startTime !== null) continue;
        const eitherTemp = result[i].id.startsWith("temp-") || result[i + 1].id.startsWith("temp-");
        if (!eitherTemp) continue;
        const combined = result[i].text + result[i + 1].text;
        if (combined === old.text) {
          usedIds.add(old.id);
          const mid = old.startTime !== null && old.endTime !== null
            ? old.startTime + (old.endTime - old.startTime) / 2
            : null;
          result[i] = { ...result[i], id: `split-a-${old.id}`, startTime: old.startTime, endTime: mid ?? old.endTime, fadeIn: old.fadeIn ?? 0, fadeOut: 0 };
          result[i + 1] = { ...result[i + 1], id: `split-b-${old.id}`, startTime: mid ?? old.startTime, endTime: old.endTime, fadeIn: 0, fadeOut: old.fadeOut ?? 0 };
          break;
        }
      }
    }

    for (let i = 0; i < result.length; i++) {
      if (!result[i].id.startsWith("temp-")) continue;
      const newText = result[i].text;
      if (!newText) continue;
      for (let j = 0; j < lyrics.length - 1; j++) {
        const a = lyrics[j];
        const b = lyrics[j + 1];
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        if ((a.startTime === null && a.endTime === null) && (b.startTime === null && b.endTime === null)) continue;
        if (a.text + b.text === newText) {
          const st = a.startTime ?? b.startTime;
          const et = b.endTime ?? a.endTime;
          result[i] = { ...result[i], id: `merge-${a.id}-${b.id}`, startTime: st, endTime: et, fadeIn: a.fadeIn ?? 0, fadeOut: b.fadeOut ?? 0 };
          usedIds.add(a.id);
          usedIds.add(b.id);
          break;
        }
      }
    }

    if (contentLines.length === lyrics.length) {
      for (let i = 0; i < result.length; i++) {
        if (!result[i].id.startsWith("temp-")) continue;
        const original = lyrics[i];
        if (original && !usedIds.has(original.id) && (original.startTime !== null || original.endTime !== null)) {
          result[i] = { ...result[i], id: `idx-${original.id}`, startTime: original.startTime, endTime: original.endTime, fadeIn: original.fadeIn ?? 0, fadeOut: original.fadeOut ?? 0 };
          usedIds.add(original.id);
        }
      }
    }

    return result;
  }, [lyricsTextDirty, lyricsText, lyrics, id]);

  const reorderLyricsByTimeline = useCallback((inputLyrics: LyricLine[]): LyricLine[] => {
    if (!inputLyrics || inputLyrics.length === 0) return inputLyrics;
    const timed = inputLyrics.filter(l => l.startTime !== null);
    const untimed = inputLyrics.filter(l => l.startTime === null);
    const sorted = [...timed].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const finalOrder = [...sorted, ...untimed];
    const GAP_THRESHOLD = 0.1;

    const result: LyricLine[] = [];
    for (let i = 0; i < finalOrder.length; i++) {
      const cur = finalOrder[i];
      let hasGap = false;
      if (i > 0 && cur.startTime !== null) {
        const prev = finalOrder[i - 1];
        if (prev.endTime !== null && cur.startTime !== null) {
          hasGap = (cur.startTime - prev.endTime) > GAP_THRESHOLD;
        }
      }
      result.push({ ...cur, lineIndex: i, blankBefore: hasGap });
    }
    return result;
  }, []);

  const syncBlankFromTimeline = useCallback((updatedLyrics: LyricLine[]) => {
    try {
      if (!id || !updatedLyrics || updatedLyrics.length === 0) return;

      const reordered = reorderLyricsByTimeline(updatedLyrics);
      const needsUpdate = reordered.some((r, i) => {
        const orig = updatedLyrics.find(l => l.id === r.id);
        return !orig || orig.lineIndex !== r.lineIndex || !!orig.blankBefore !== !!r.blankBefore;
      });

      if (needsUpdate) {
        setLyrics(reordered);
        const normalizedText = lyricsToText(reordered);
        if (!lyricsTextDirty) {
          setLyricsText(normalizedText);
          lyricsTextRef.current = normalizedText;
          lastSyncedTextRef.current = normalizedText;
        }
        const orderUpdates = reordered.map(r => ({ id: r.id, lineIndex: r.lineIndex, blankBefore: !!r.blankBefore }));
        storage.updateLyricOrder(orderUpdates).then(() => {
          
        });
      }
    } catch (e) {
      console.error("[syncBlankFromTimeline] error:", e);
    }
  }, [id, lyricsToText, reorderLyricsByTimeline, lyricsTextDirty]);

  const updateTimings = useCallback(async (updates: { id: string; startTime: number | null; endTime: number | null }[], description?: string) => {
    const oldValues = lyrics?.filter(l => updates.some(u => u.id === l.id)).map(l => ({ id: l.id, startTime: l.startTime, endTime: l.endTime })) || [];
    await storage.updateLyricTimings(updates);
    const newLyrics = lyrics?.map((l) => {
      const upd = updates.find((u) => u.id === l.id);
      return upd ? { ...l, startTime: upd.startTime, endTime: upd.endTime } : l;
    }) || [];
    setLyrics(newLyrics);
    if (oldValues.length > 0) {
      pushUndo({
        description: description || "タイミング変更",
        undo: async () => {
          await storage.updateLyricTimings(oldValues.map(o => ({ id: o.id, startTime: o.startTime, endTime: o.endTime })));
          setLyrics(prev => prev?.map(l => { const o = oldValues.find(v => v.id === l.id); return o ? { ...l, startTime: o.startTime, endTime: o.endTime } : l; }));
          if (id) syncService.schedulePush(id);
        },
        redo: async () => {
          await storage.updateLyricTimings(updates);
          setLyrics(prev => prev?.map(l => { const u = updates.find(v => v.id === l.id); return u ? { ...l, startTime: u.startTime, endTime: u.endTime } : l; }));
          if (id) syncService.schedulePush(id);
        },
      });
    }
    if (id) syncService.schedulePush(id);
    syncBlankFromTimeline(newLyrics);
  }, [id, lyrics, pushUndo, syncBlankFromTimeline]);

  const updateFades = useCallback(async (updates: { id: string; fadeIn: number; fadeOut: number }[]) => {
    const oldValues = lyrics?.filter(l => updates.some(u => u.id === l.id)).map(l => ({ id: l.id, fadeIn: l.fadeIn ?? 0, fadeOut: l.fadeOut ?? 0 })) || [];
    await storage.updateLyricFades(updates);
    setLyrics(prev => prev?.map((l) => {
      const upd = updates.find((u) => u.id === l.id);
      return upd ? { ...l, fadeIn: upd.fadeIn, fadeOut: upd.fadeOut } : l;
    }));
    if (oldValues.length > 0) {
      pushUndo({
        description: "フェード変更",
        undo: async () => {
          await storage.updateLyricFades(oldValues);
          setLyrics(prev => prev?.map(l => { const o = oldValues.find(v => v.id === l.id); return o ? { ...l, fadeIn: o.fadeIn, fadeOut: o.fadeOut } : l; }));
          if (id) syncService.schedulePush(id);
        },
        redo: async () => {
          await storage.updateLyricFades(updates);
          setLyrics(prev => prev?.map(l => { const u = updates.find(v => v.id === l.id); return u ? { ...l, fadeIn: u.fadeIn, fadeOut: u.fadeOut } : l; }));
          if (id) syncService.schedulePush(id);
        },
      });
    }
    if (id) syncService.schedulePush(id);
  }, [id, lyrics, pushUndo]);

  const updateProjectData = useCallback(async (data: Partial<Project>, undoDesc?: string) => {
    if (!id) return;
    const oldData: Partial<Project> = {};
    const currentProject = project;
    if (currentProject) {
      for (const key of Object.keys(data)) {
        (oldData as any)[key] = (currentProject as any)[key];
      }
    }
    setProject(prev => prev ? { ...prev, ...data } : prev);
    try {
      const updated = await storage.updateProject(id, data);
      if (updated) {
        setProject(updated);
        syncService.schedulePush(id);
      }
    } catch {
    }
    if (currentProject && undoDesc !== "__skip_undo__") {
      pushUndo({
        description: undoDesc || "設定変更",
        undo: async () => {
          setProject(prev => prev ? { ...prev, ...oldData } : prev);
          await storage.updateProject(id, oldData);
          
        },
        redo: async () => {
          setProject(prev => prev ? { ...prev, ...data } : prev);
          await storage.updateProject(id, data);
          
        },
      });
    }
  }, [id, project, pushUndo]);
  updateProjectDataRef.current = updateProjectData;

  const textUndoStackRef = useRef<{ text: string; selStart: number; selEnd: number }[]>([]);
  const textRedoStackRef = useRef<{ text: string; selStart: number; selEnd: number }[]>([]);
  const textUndoLastPushRef = useRef(0);

  const pushTextUndo = useCallback((text: string, selStart?: number, selEnd?: number, keepRedo?: boolean) => {
    const stack = textUndoStackRef.current;
    if (stack.length > 0 && stack[stack.length - 1].text === text) return;
    stack.push({ text, selStart: selStart ?? text.length, selEnd: selEnd ?? text.length });
    if (stack.length > 100) stack.shift();
    if (!keepRedo) textRedoStackRef.current = [];
    textUndoLastPushRef.current = Date.now();
  }, []);

  const saveLyricsToDb = useCallback(async (text: string, skipUndo?: boolean) => {
    if (!id) return;
    const oldText = lastSyncedTextRef.current;
    if (oldText === text) return;
    const snapshotBefore = await storage.getFullProjectSnapshot(id);
    const rawLines = text.split("\n");
    const parsedLines: { text: string; lineIndex: number; blankBefore: boolean }[] = [];
    let pendingBlank = false;
    let idx = 0;
    for (const raw of rawLines) {
      if (raw.trim() === "") {
        if (!pendingBlank) {
          pendingBlank = true;
        }
      } else {
        parsedLines.push({ text: raw, lineIndex: idx, blankBefore: pendingBlank });
        pendingBlank = false;
        idx++;
      }
    }

    const result = await storage.setLyricLines(id, parsedLines);

    setLyrics(result);
    const normalizedText = lyricsToText(result);
    const userStillEditing = lyricsTextRef.current !== text;
    if (!userStillEditing) {
      setLyricsText(normalizedText);
      lyricsTextRef.current = normalizedText;
      setLyricsTextDirty(false);
    }
    lastSyncedTextRef.current = normalizedText;
    if (!skipUndo && oldText !== text && snapshotBefore) {
      const snapshotAfter = await storage.getFullProjectSnapshot(id);
      pushUndo({
        description: "歌詞編集",
        undo: async () => {
          await storage.restoreFullProjectSnapshot(snapshotBefore);
          const restoredLyrics = await storage.getLyricLines(id);
          setLyrics(restoredLyrics);
          const restoredText = lyricsToText(restoredLyrics);
          setLyricsText(restoredText);
          lyricsTextRef.current = restoredText;
          lastSyncedTextRef.current = restoredText;
          setLyricsTextDirty(false);
        },
        redo: async () => {
          if (snapshotAfter) await storage.restoreFullProjectSnapshot(snapshotAfter);
          const restoredLyrics = await storage.getLyricLines(id);
          setLyrics(restoredLyrics);
          const restoredText = lyricsToText(restoredLyrics);
          setLyricsText(restoredText);
          lyricsTextRef.current = restoredText;
          lastSyncedTextRef.current = restoredText;
          setLyricsTextDirty(false);
        },
      });
    }
  }, [id, pushUndo, lyricsToText]);

  const handleSaveAs = useCallback(async () => {
    if (!id || !saveAsName.trim()) return;
    setSaveAsProcessing(true);
    try {
      if (lyricsTextDirty) {
        await saveLyricsToDb(lyricsTextRef.current);
      }
      const newProject = await storage.duplicateProject(id, saveAsName.trim());
      toast({ title: `「${newProject.name}」として保存しました` });
      setSaveAsOpen(false);
      setSaveAsName("");
      navigate(`/project/${newProject.id}`);
    } catch (err: any) {
      toast({ title: "保存エラー", description: err.message, variant: "destructive" });
    } finally {
      setSaveAsProcessing(false);
    }
  }, [id, saveAsName, lyricsTextDirty, saveLyricsToDb, toast, navigate]);

  const [uploadingLyrics, setUploadingLyrics] = useState(false);
  const uploadLyricsFile = useCallback(async (file: File) => {
    if (!id) return;
    setUploadingLyrics(true);
    try {
      const lines = await extractTextFromFile(file);
      const result = await storage.setLyricLines(id, lines.map((text, i) => ({ text, lineIndex: i })));
      setLyrics(result);
      setLyricsInitialized(false);
      setLyricsTextDirty(false);
      lastSyncedTextRef.current = "";
      toast({ title: `${result.length}行の歌詞を読み込みました` });
    } catch (err: any) {
      toast({ title: "読み込みエラー", description: err.message, variant: "destructive" });
    } finally {
      setUploadingLyrics(false);
    }
  }, [id, toast]);

  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [editingAudioName, setEditingAudioName] = useState(false);
  const [audioCompressProgress, setAudioCompressProgress] = useState<number | null>(null);
  const [audioProcessPhase, setAudioProcessPhase] = useState<string>("");
  const [timelineSelectedIds, setTimelineSelectedIds] = useState<Set<string>>(new Set());
  const timelineSelectedIdsRef = useRef(timelineSelectedIds);
  timelineSelectedIdsRef.current = timelineSelectedIds;

  const [pendingAudioFile, setPendingAudioFile] = useState<File | null>(null);
  const [audioConfirmStep, setAudioConfirmStep] = useState<"none" | "enter_name">("none");
  const [pendingTrackLabel, setPendingTrackLabel] = useState("");

  const compressAbortRef = useRef<AbortController | null>(null);

  const handleAudioDrop = useCallback((file: File) => {
    if (!id) return;
    if (uploadingAudio) {
      toast({ title: "音声を処理中です。完了までお待ちください", variant: "destructive" });
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const audioExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "opus", "webm", "mp4"];
    const isAudio = file.type.startsWith("audio/") || audioExts.includes(ext);
    if (!isAudio) {
      toast({ title: "音声ファイルではありません", variant: "destructive" });
      return;
    }
    const defaultLabel = file.name.replace(/\.[^.]+$/, "");
    setPendingAudioFile(file);
    setPendingTrackLabel(defaultLabel);

    setAudioConfirmStep("enter_name");
  }, [id, toast, audioTracks, audioUrl, uploadingAudio]);

  const cancelAudioImport = useCallback(() => {
    setPendingAudioFile(null);
    setPendingTrackLabel("");
    setAudioConfirmStep("none");
  }, []);


  const executeAudioImport = useCallback(async () => {
    if (!id || !pendingAudioFile) return;
    const file = pendingAudioFile;
    const trackLabel = pendingTrackLabel.trim() || file.name.replace(/\.[^.]+$/, "");
    setAudioConfirmStep("none");
    setPendingAudioFile(null);

    if (compressAbortRef.current) compressAbortRef.current.abort();
    const abort = new AbortController();
    compressAbortRef.current = abort;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isWav = file.type === "audio/wav" || file.type === "audio/wave" || file.type === "audio/x-wav" || ext === "wav";
    const isLargeFile = file.size > 10 * 1024 * 1024;

    let tempBlobUrl: string | null = null;
    if (!isWav && !isLargeFile) {
      tempBlobUrl = URL.createObjectURL(file);
      setAudioUrl(tempBlobUrl);
    } else {
      setAudioUrl(null);
      setAudioArrayBuffer(null);
    }

    setUploadingAudio(true);
    setAudioCompressProgress(0);
    setAudioProcessPhase("ファイル読み込み中...");
    try {
      const tempArrayBuffer = await file.arrayBuffer();
      if (abort.signal.aborted) { if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl); return; }

      setAudioProcessPhase(isWav ? "WAVデータ解析中..." : "音声デコード中...");
      setAudioCompressProgress(2);

      let mp3Blob: Blob;
      try {
        const { compressToMp3FromBuffer } = await import("@/lib/audioCompress");
        mp3Blob = await compressToMp3FromBuffer(tempArrayBuffer, isWav, (p) => {
          if (abort.signal.aborted) return;
          setAudioCompressProgress(p);
          if (p < 5) setAudioProcessPhase(isWav ? "WAVデータ解析中..." : "音声デコード中...");
          else setAudioProcessPhase("MP3に変換中...");
        }, abort.signal);
      } catch (clientErr) {
        if (abort.signal.aborted) return;
        setAudioProcessPhase("サーバーでMP3変換中...");
        setAudioCompressProgress(50);
        const fileExt = file.name.split(".").pop()?.toLowerCase() || "wav";
        const convRes = await fetch(`/api/audio/convert-to-mp3?ext=.${fileExt}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob([tempArrayBuffer]),
        });
        if (!convRes.ok) {
          const errData = await convRes.json().catch(() => ({}));
          throw new Error(errData.message || "MP3変換に失敗しました");
        }
        mp3Blob = await convRes.blob();
      }
      if (abort.signal.aborted) return;

      setAudioProcessPhase("トラック保存中...");
      setAudioCompressProgress(100);
      const mp3FileName = file.name.replace(/\.[^.]+$/, "") + ".mp3";

      for (const oldTrack of audioTracks) {
        await storage.deleteAudioTrack(oldTrack.id);
      }

      const newTrack = await storage.saveAudioTrack(id, mp3Blob, mp3FileName, trackLabel, "audio/mpeg");
      await storage.updateProject(id, { audioFileName: mp3FileName, activeAudioTrackId: newTrack.id });
      if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl);
      const blobUrl = URL.createObjectURL(mp3Blob);
      setAudioUrl(blobUrl);
      setAudioArrayBuffer(await mp3Blob.arrayBuffer());
      await storage.updateProject(id, { detectedBpm: null } as any);
      setProject(prev => prev ? { ...prev, audioFileName: mp3FileName, activeAudioTrackId: newTrack.id, detectedBpm: null } : prev);
      const tracks = await storage.getAudioTracks(id);
      setAudioTracks(tracks);
      const sizeMB = (mp3Blob.size / (1024 * 1024)).toFixed(1);
      toast({ title: `音源「${trackLabel}」を読み込みました (${sizeMB}MB)` });

      const currentPreset = project?.preset || "other";
      const formData = new FormData();
      formData.append("audio", mp3Blob, mp3FileName);
      formData.append("preset", currentPreset);
      formData.append("fileName", mp3FileName);
      const doDropboxUpload = (uploadFormData: FormData) => {
        fetch("/api/dropbox/upload", { method: "POST", body: uploadFormData })
          .then(async (dbxRes) => {
            if (dbxRes.ok) {
              const dbxData = await dbxRes.json();
              console.log("[DropboxUpload] Success, path:", dbxData.dropboxPath);
              await storage.updateAudioTrackDropboxPath(newTrack.id, dbxData.dropboxPath);
              const updatedTracks = await storage.getAudioTracks(id);
              setAudioTracks(updatedTracks);
              toast({ title: `Dropboxに保存しました: ${dbxData.fileName}` });
            } else {
              const errData = await dbxRes.json().catch(() => ({}));
              console.warn("[DropboxUpload] Failed:", dbxRes.status, errData);
            }
          })
          .catch((err) => {
            console.warn("[DropboxUpload] Error:", err);
          });
      };
      try {
        const checkRes = await fetch(`/api/dropbox/check-exists?preset=${encodeURIComponent(currentPreset)}&fileName=${encodeURIComponent(mp3FileName)}`);
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.exists && checkData.suggestedName) {
            setDropboxDuplicateDialog({
              fileName: mp3FileName,
              suggestedName: checkData.suggestedName,
              formData,
              trackId: newTrack.id,
            });
          } else {
            formData.append("mode", "auto");
            doDropboxUpload(formData);
          }
        } else {
          formData.append("mode", "auto");
          doDropboxUpload(formData);
        }
      } catch {
        formData.append("mode", "auto");
        doDropboxUpload(formData);
      }
    } catch (err: any) {
      if (!abort.signal.aborted) {
        toast({ title: "音声変換エラー", description: err.message, variant: "destructive" });
      }
    } finally {
      setUploadingAudio(false);
      setAudioCompressProgress(null);
      setAudioProcessPhase("");
      compressAbortRef.current = null;
      setPendingTrackLabel("");
    }
  }, [id, pendingAudioFile, pendingTrackLabel, toast, audioUrl]);

  const uploadAudioFile = useCallback((file: File) => {
    if (!id) return;
    handleAudioDrop(file);
  }, [id, handleAudioDrop]);

  const handleDropboxSelect = useCallback(async (dropboxFile: { name: string; path: string; size: number }) => {
    if (!id) return;
    setDropboxPickerOpen(false);

    const ext = dropboxFile.name.split(".").pop()?.toLowerCase() || "";
    const docExts = ["docx", "xlsx", "xls", "txt", "pdf"];
    const audioExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "aiff", "mp4"];

    if (docExts.includes(ext)) {
      setUploadingLyrics(true);
      try {
        const res = await fetch(`/api/dropbox/download?path=${encodeURIComponent(dropboxFile.path)}`);
        if (!res.ok) throw new Error("Dropboxからのダウンロード失敗");
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        const file = new File([blob], dropboxFile.name);
        const lines = await extractTextFromFile(file);
        const result = await storage.setLyricLines(id, lines.map((text, i) => ({ text, lineIndex: i })));
        setLyrics(result);
        setLyricsInitialized(false);
        setLyricsTextDirty(false);
        lastSyncedTextRef.current = "";
        toast({ title: `${result.length}行の歌詞を読み込みました` });
      } catch (err: any) {
        toast({ title: "Dropbox読み込みエラー", description: err.message, variant: "destructive" });
      } finally {
        setUploadingLyrics(false);
      }
      return;
    }

    if (audioExts.includes(ext)) {
      setUploadingAudio(true);
      setAudioCompressProgress(0);
      const needsConvert = ext !== "mp3";
      setAudioProcessPhase(needsConvert ? "Dropboxからダウンロード＆MP3変換中..." : "Dropboxからダウンロード中...");
      try {
        const downloadUrl = needsConvert
          ? `/api/dropbox/download?path=${encodeURIComponent(dropboxFile.path)}&convert=mp3`
          : `/api/dropbox/download?path=${encodeURIComponent(dropboxFile.path)}`;
        const res = await fetch(downloadUrl);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || "Dropboxからのダウンロード失敗");
        }
        const arrayBuffer = await res.arrayBuffer();
        const trackLabel = dropboxFile.name.replace(/\.[^.]+$/i, "");
        const finalBlob = new Blob([arrayBuffer], { type: "audio/mpeg" });
        const finalArrayBuffer = arrayBuffer;

        setAudioProcessPhase("トラック保存中...");
        setAudioCompressProgress(95);

        let existingEmptyTrack: { id: string } | null = null;
        if (project?.activeAudioTrackId) {
          const activeTrack = await storage.getAudioTrack(project.activeAudioTrackId);
          if (activeTrack && (!activeTrack.arrayBuffer || activeTrack.arrayBuffer.byteLength === 0)) {
            existingEmptyTrack = activeTrack;
          }
        }

        const mp3FileName = dropboxFile.name.replace(/\.[^.]+$/i, ".mp3");

        let savedTrackId: string;
        if (existingEmptyTrack) {
          await storage.updateAudioTrackBlob(existingEmptyTrack.id, finalArrayBuffer);
          await storage.updateAudioTrackDropboxPath(existingEmptyTrack.id, dropboxFile.path);
          await storage.updateProject(id, { audioFileName: mp3FileName });
          savedTrackId = existingEmptyTrack.id;
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          const blobUrl = URL.createObjectURL(finalBlob);
          setAudioUrl(blobUrl);
          setAudioArrayBuffer(finalArrayBuffer);
          setProject(prev => prev ? { ...prev, audioFileName: mp3FileName } : prev);
          const tracks = await storage.getAudioTracks(id);
          setAudioTracks(tracks);
          const sizeMB = (finalBlob.size / (1024 * 1024)).toFixed(1);
          toast({ title: `音源を再リンクしました「${trackLabel}」(${sizeMB}MB)` });
        } else {
          const newTrack = await storage.saveAudioTrack(id, finalBlob, mp3FileName, trackLabel, "audio/mpeg", dropboxFile.path);
          await storage.updateProject(id, { audioFileName: mp3FileName, activeAudioTrackId: newTrack.id });
          savedTrackId = newTrack.id;
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          const blobUrl = URL.createObjectURL(finalBlob);
          setAudioUrl(blobUrl);
          setAudioArrayBuffer(finalArrayBuffer);
          setProject(prev => prev ? { ...prev, audioFileName: mp3FileName, activeAudioTrackId: newTrack.id } : prev);
          const tracks = await storage.getAudioTracks(id);
          setAudioTracks(tracks);
          const sizeMB = (finalBlob.size / (1024 * 1024)).toFixed(1);
          toast({ title: `Dropboxから「${trackLabel}」を読み込みました (${sizeMB}MB)` });
        }

        const capturedPreset = project?.preset || "other";
        const capturedProjectId = id;
        const copyFormData = new FormData();
        copyFormData.append("audio", finalBlob, mp3FileName);
        copyFormData.append("preset", capturedPreset);
        copyFormData.append("fileName", mp3FileName);
        copyFormData.append("mode", "auto");
        fetch("/api/dropbox/upload", { method: "POST", body: copyFormData })
          .then(async (dbxRes) => {
            if (dbxRes.ok) {
              const dbxData = await dbxRes.json();
              console.log("[DropboxCopy] Copied to Telop音源:", dbxData.dropboxPath);
              await storage.updateAudioTrackDropboxPath(savedTrackId, dbxData.dropboxPath);
              const updatedTracks = await storage.getAudioTracks(capturedProjectId);
              setAudioTracks(updatedTracks);
              toast({ title: `Telop音源にコピーしました: ${dbxData.fileName}` });
            } else {
              const errData = await dbxRes.json().catch(() => ({}));
              console.warn("[DropboxCopy] Failed, keeping original path:", dbxRes.status, errData);
            }
          })
          .catch((err) => {
            console.warn("[DropboxCopy] Error, keeping original path:", err);
          });
      } catch (err: any) {
        toast({ title: "Dropbox読み込みエラー", description: err.message, variant: "destructive" });
      } finally {
        setUploadingAudio(false);
        setAudioCompressProgress(null);
        setAudioProcessPhase("");
      }
      return;
    }

    toast({ title: "非対応のファイル形式です", description: `${ext}ファイルには対応していません`, variant: "destructive" });
  }, [id, toast, audioUrl]);

  const openPersonalDropboxChooser = useCallback(() => {
    const Dropbox = (window as any).Dropbox;
    if (!Dropbox || !Dropbox.choose) {
      toast({ title: "Dropbox Chooser SDKが読み込まれていません", variant: "destructive" });
      return;
    }
    Dropbox.choose({
      success: async (files: any[]) => {
        if (!files.length || !id) return;
        const file = files[0];
        const fileName = file.name;
        const link = file.link;
        setUploadingAudio(true);
        setAudioCompressProgress(0);
        setAudioProcessPhase("個人Dropboxからダウンロード中...");
        try {
          const dlRes = await fetch(link);
          if (!dlRes.ok) throw new Error("ファイルのダウンロードに失敗しました");
          const rawBuffer = await dlRes.arrayBuffer();
          const ext = fileName.split(".").pop()?.toLowerCase() || "";
          const isAudioFile = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma"].includes(ext);
          if (!isAudioFile) {
            toast({ title: "音声ファイルを選択してください", variant: "destructive" });
            return;
          }

          let finalBuffer: ArrayBuffer;
          if (ext !== "mp3") {
            setAudioProcessPhase("サーバーでMP3変換中...");
            setAudioCompressProgress(50);
            const convRes = await fetch(`/api/audio/convert-to-mp3?ext=.${ext}`, {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: rawBuffer,
            });
            if (!convRes.ok) {
              const errData = await convRes.json().catch(() => ({}));
              throw new Error(errData.message || "MP3変換に失敗しました");
            }
            finalBuffer = await convRes.arrayBuffer();
          } else {
            finalBuffer = rawBuffer;
          }
          const blob = new Blob([finalBuffer], { type: "audio/mpeg" });
          const mp3FileName = fileName.replace(/\.[^.]+$/i, ".mp3");
          const fakeFile = new File([blob], mp3FileName, { type: "audio/mpeg" });
          setUploadingAudio(false);
          setAudioCompressProgress(null);
          setAudioProcessPhase("");
          handleAudioDrop(fakeFile);
        } catch (err: any) {
          toast({ title: "ダウンロードエラー", description: err.message, variant: "destructive" });
          setUploadingAudio(false);
          setAudioCompressProgress(null);
          setAudioProcessPhase("");
        }
      },
      cancel: () => {},
      linkType: "direct",
      multiselect: false,
      extensions: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
      folderselect: false,
    });
  }, [id, toast, handleAudioDrop]);

  const fetchDropboxOAuthStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dropbox/oauth/status");
      if (res.ok) setDropboxOAuthStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchDropboxOAuthStatus(); }, [fetchDropboxOAuthStatus]);

  const handleDropboxOAuthConnect = useCallback(async () => {
    setDropboxOAuthConnecting(true);
    const popup = window.open("/api/dropbox/oauth/start", "dropbox-auth", "width=600,height=700");
    const listener = async (e: MessageEvent) => {
      if (e.data === "dropbox-connected") {
        window.removeEventListener("message", listener);
        await fetchDropboxOAuthStatus();
        setDropboxOAuthConnecting(false);
        setDropboxOAuthDialogOpen(false);
        toast({ title: "✅ Dropbox接続完了", description: "チームDropboxに接続しました。音源を自動復元します..." });
        // 音源が未ロードの場合、自動的に再ロードを試みる
        setAudioRetryKey(k => k + 1);
      }
    };
    window.addEventListener("message", listener);
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        window.removeEventListener("message", listener);
        setDropboxOAuthConnecting(false);
      }
    }, 500);
  }, [fetchDropboxOAuthStatus, toast]);

  const handleDropboxDuplicateChoice = useCallback(async (choice: "overwrite" | "rename" | "skip") => {
    if (!dropboxDuplicateDialog) return;
    const { formData, trackId, suggestedName } = dropboxDuplicateDialog;
    setDropboxDuplicateDialog(null);
    if (choice === "skip") return;
    formData.append("mode", choice);
    if (choice === "rename") {
      formData.set("fileName", suggestedName);
    }
    try {
      const dbxRes = await fetch("/api/dropbox/upload", { method: "POST", body: formData });
      if (dbxRes.ok) {
        const dbxData = await dbxRes.json();
        await storage.updateAudioTrackDropboxPath(trackId, dbxData.dropboxPath);
        if (id) {
          const updatedTracks = await storage.getAudioTracks(id);
          setAudioTracks(updatedTracks);
        }
        toast({ title: `Dropboxに保存しました: ${dbxData.fileName}` });
      }
    } catch {
      // silently fail
    }
  }, [dropboxDuplicateDialog, id, toast]);

  const handleSwitchAudioTrack = useCallback(async (trackId: string) => {
    if (!id) return;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);

    const track = await storage.getAudioTrack(trackId);
    if (!track) return;

    await storage.updateProject(id, { audioFileName: track.fileName, activeAudioTrackId: trackId, detectedBpm: null } as any);
    setProject(prev => prev ? { ...prev, audioFileName: track.fileName, activeAudioTrackId: trackId, detectedBpm: null } : prev);
  }, [id, audioUrl]);

  const handleDeleteAudioTrack = useCallback(async (trackId: string) => {
    if (!id) return;
    const trackInfo = await storage.getAudioTrack(trackId);
    const trackFromState = audioTracks.find(t => t.id === trackId);
    const dropboxPath = trackInfo?.dropboxPath || trackFromState?.dropboxPath;

    const resolvedPath = dropboxPath || (() => {
      const fileName = trackInfo?.fileName || trackFromState?.fileName;
      const preset = project?.preset || "other";
      if (!fileName) return null;
      return `/Telop音源/${preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER"}/${fileName}`;
    })();

    if (resolvedPath) {
      const otherCount = await storage.countTracksWithDropboxPath(resolvedPath, trackId);
      if (otherCount === 0) {
        try {
          const res = await fetch("/api/dropbox/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dropboxPath: resolvedPath }),
          });
          const data = await res.json();
          if (res.ok) {
            toast({ title: "Dropboxからも削除しました" });
          } else {
            toast({ title: "Dropbox削除失敗: " + (data.message || ""), variant: "destructive" });
          }
        } catch (err: any) {
          toast({ title: "Dropbox削除エラー", variant: "destructive" });
        }
      } else {
        toast({ title: `他の${otherCount}件のプロジェクトで使用中のため、Dropboxからは削除しません` });
      }
    }
    await storage.deleteAudioTrack(trackId);
    const tracks = await storage.getAudioTracks(id);
    setAudioTracks(tracks);
    if (project?.activeAudioTrackId === trackId) {
      if (tracks.length > 0) {
        const next = tracks[0];
        await storage.updateProject(id, { audioFileName: next.fileName, activeAudioTrackId: next.id });
        setProject(prev => prev ? { ...prev, audioFileName: next.fileName, activeAudioTrackId: next.id } : prev);
      } else {
        await storage.updateProject(id, { audioFileName: null, activeAudioTrackId: null });
        setProject(prev => prev ? { ...prev, audioFileName: null, activeAudioTrackId: null } : prev);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        setAudioArrayBuffer(null);
      }
    }
  }, [id, project?.activeAudioTrackId, audioUrl]);

  const handleRenameAudioTrack = useCallback(async (trackId: string, label: string) => {
    await storage.renameAudioTrack(trackId, label);
    if (id) {
      const tracks = await storage.getAudioTracks(id);
      setAudioTracks(tracks);
    }
  }, [id]);

  const handleRenameAudioFile = useCallback(async (newBaseName: string) => {
    if (!id || !project?.activeAudioTrackId) return;
    const trackId = project.activeAudioTrackId;
    const track = audioTracks.find(t => t.id === trackId);
    if (!track) return;
    const newFileName = newBaseName.replace(/\.mp3$/i, "") + ".mp3";
    if (newFileName === track.fileName) return;

    let newDropboxPath: string | undefined;
    const oldDropboxPath = track.dropboxPath;
    if (oldDropboxPath) {
      const dir = oldDropboxPath.substring(0, oldDropboxPath.lastIndexOf("/"));
      const targetPath = `${dir}/${newFileName}`;
      try {
        const res = await fetch("/api/dropbox/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromPath: oldDropboxPath, toPath: targetPath }),
        });
        const data = await res.json();
        if (res.ok) {
          newDropboxPath = data.newPath;
          toast({ title: `Dropbox: ${track.fileName} → ${newFileName}` });
        } else {
          toast({ title: "Dropboxリネーム失敗: " + (data.message || ""), variant: "destructive" });
          return;
        }
      } catch (err: any) {
        toast({ title: "Dropboxリネームエラー", variant: "destructive" });
        return;
      }
    }

    await storage.renameAudioTrackFile(trackId, newFileName, newDropboxPath);
    await storage.updateProject(id, { audioFileName: newFileName });
    setProject(prev => prev ? { ...prev, audioFileName: newFileName } : prev);
    const tracks = await storage.getAudioTracks(id);
    setAudioTracks(tracks);
    if (project?.id) syncService.schedulePush(project.id);
  }, [id, project?.activeAudioTrackId, project?.id, audioTracks, toast]);

  useEffect(() => {
    return () => {
      if (compressAbortRef.current) compressAbortRef.current.abort();
    };
  }, []);

  const audioLoadEpoch = useRef(0);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      await storage.ensureAudioTrackMigrated(id);
      const tracks = await storage.getAudioTracks(id);
      setAudioTracks(tracks);
      if (tracks.length > 0 && project && !project.activeAudioTrackId) {
        const firstTrack = tracks[0];
        await storage.updateProject(id, { activeAudioTrackId: firstTrack.id, audioFileName: firstTrack.fileName });
        setProject(prev => prev ? { ...prev, activeAudioTrackId: firstTrack.id, audioFileName: firstTrack.fileName } : prev);
      }
    };
    load();
  }, [id]);

  useEffect(() => {
    const trackId = project?.activeAudioTrackId;
    if (!id || !trackId) {
      if (!project?.audioFileName) return;
      const epoch = ++audioLoadEpoch.current;
      let objectUrl: string | null = null;
      const loadLegacy = async () => {
        try {
          const audio = await storage.getAudio(id);
          if (audioLoadEpoch.current !== epoch || !audio) return;
          const blob = new Blob([audio.arrayBuffer], { type: audio.mimeType || "audio/mpeg" });
          objectUrl = URL.createObjectURL(blob);
          setAudioUrl(objectUrl);
          setAudioArrayBuffer(audio.arrayBuffer);
        } catch (e) {
          console.warn("Audio load failed:", e);
        }
      };
      loadLegacy();
      return () => {
        audioLoadEpoch.current++;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setAudioUrl(null);
        setAudioArrayBuffer(null);
      };
    }

    const epoch = ++audioLoadEpoch.current;
    let objectUrl: string | null = null;
    const loadTrack = async () => {
      try {
        const track = await storage.getAudioTrack(trackId);
        if (audioLoadEpoch.current !== epoch || !track) return;

        if (track.arrayBuffer.byteLength > 0) {
          const blob = new Blob([track.arrayBuffer], { type: track.mimeType || "audio/mpeg" });
          objectUrl = URL.createObjectURL(blob);
          setAudioUrl(objectUrl);
          setAudioArrayBuffer(track.arrayBuffer);
        } else {
          const resolvedDropboxPath = track.dropboxPath || (() => {
            const preset = projectRef.current?.preset || "other";
            const fn = track.fileName;
            if (!fn) return null;
            return `/Telop音源/${preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER"}/${fn}`;
          })();

          const tryDownload = async (downloadPath: string): Promise<{ data: ArrayBuffer | null; status: number }> => {
            const pathExt = downloadPath.split(".").pop()?.toLowerCase() || "";
            const needsConvert = pathExt !== "mp3" && ["wav", "m4a", "aac", "ogg", "flac", "wma", "aiff"].includes(pathExt);
            const url = needsConvert
              ? `/api/dropbox/download?path=${encodeURIComponent(downloadPath)}&convert=mp3`
              : `/api/dropbox/download?path=${encodeURIComponent(downloadPath)}`;
            const res = await fetchDropbox(url);
            if (audioLoadEpoch.current !== epoch) return { data: null, status: 0 };
            if (!res.ok) return { data: null, status: res.status };
            const data = await res.arrayBuffer();
            return { data, status: res.status };
          };

          if (resolvedDropboxPath || track.fileName || projectRef.current?.name) {
            setAudioProcessPhase("Dropboxから音声を読み込み中...");
            setUploadingAudio(true);
            setAudioCompressProgress(0);
            try {
              let ab: ArrayBuffer | null = null;
              let finalPath = resolvedDropboxPath;
              let lastStatus = 0;

              if (resolvedDropboxPath) {
                const result = await tryDownload(resolvedDropboxPath);
                ab = result.data;
                lastStatus = result.status;
              }

              const isPathNotFound = !ab && (lastStatus === 500 || lastStatus === 404 || lastStatus === 409);

              if (isPathNotFound && resolvedDropboxPath) {
                const migrationPaths: string[] = [];
                if (resolvedDropboxPath.startsWith("/Telop音源/")) {
                  migrationPaths.push(`/nrs チーム フォルダ/NEW TELOP${resolvedDropboxPath}`);
                  migrationPaths.push(`/nrs チーム フォルダ${resolvedDropboxPath}`);
                } else if (resolvedDropboxPath.startsWith("/nrs チーム フォルダ/Telop音源/")) {
                  migrationPaths.push(resolvedDropboxPath.replace("/nrs チーム フォルダ/Telop音源/", "/nrs チーム フォルダ/NEW TELOP/Telop音源/"));
                }
                for (const migratedPath of migrationPaths) {
                  if (ab) break;
                  setAudioProcessPhase("移行先パスで再試行中...");
                  const migratedResult = await tryDownload(migratedPath);
                  if (audioLoadEpoch.current !== epoch) return;
                  if (migratedResult.status === 401) {
                    lastStatus = 401;
                    break;
                  }
                  if (migratedResult.data && migratedResult.data.byteLength > 0) {
                    ab = migratedResult.data;
                    finalPath = migratedPath;
                  }
                }
              }

              if (!ab && isPathNotFound) {
                if (audioLoadEpoch.current !== epoch) return;
                setAudioProcessPhase("Dropbox全体を検索中...");
                const dropboxBaseName = resolvedDropboxPath ? resolvedDropboxPath.split("/").pop() || null : null;
                const searchNames = [
                  projectRef.current?.songTitle || null,
                  track.fileName,
                  projectRef.current?.name || null,
                ].filter(Boolean) as string[];
                for (let searchName of searchNames) {
                  if (ab) break;
                  // Remove extension if present for searching
                  searchName = searchName.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff)$/i, "");
                  try {
                    const findRes = await fetchDropbox(`/api/dropbox/find?fileName=${encodeURIComponent(searchName)}`);
                    if (audioLoadEpoch.current !== epoch) return;
                    if (findRes.status === 401) {
                      lastStatus = 401;
                      break;
                    }
                    if (findRes.ok) {
                      const findData = await findRes.json();
                      if (findData.found && findData.path) {
                        setAudioProcessPhase("Dropboxからダウンロード中...");
                        finalPath = findData.path;
                        const retryResult = await tryDownload(findData.path);
                        ab = retryResult.data;
                        lastStatus = retryResult.status;
                      }
                    }
                  } catch (findErr) {
                    console.warn("Dropbox find fallback failed:", findErr);
                  }
                }
              }

              if (audioLoadEpoch.current !== epoch) return;

              if (ab && ab.byteLength > 0 && finalPath) {
                await storage.updateAudioTrackBlob(trackId, ab);
                await storage.updateAudioTrackDropboxPath(trackId, finalPath);
                const blob = new Blob([ab], { type: "audio/mpeg" });
                objectUrl = URL.createObjectURL(blob);
                setAudioUrl(objectUrl);
                setAudioArrayBuffer(ab);
              } else if (!ab && lastStatus === 401) {
                toast({
                  title: "Dropbox認証エラー",
                  description: "Dropboxの接続が切れています。管理者に連絡してください。",
                  variant: "destructive",
                });
              } else {
                toast({
                  title: "音源が見つかりません",
                  description: `Dropbox上に「${track.fileName}」が見つかりませんでした。ヘッダーの「Dropboxから選ぶ」から手動で選択してください。`,
                  variant: "destructive",
                });
              }
            } finally {
              setUploadingAudio(false);
              setAudioCompressProgress(null);
              setAudioProcessPhase("");
            }
          }
        }
      } catch (e) {
        console.warn("Audio track load failed:", e);
      }
    };
    loadTrack();
    return () => {
      audioLoadEpoch.current++;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setAudioUrl(null);
      setAudioArrayBuffer(null);
    };
  }, [id, project?.activeAudioTrackId, project?.audioFileName, audioRetryKey]);

  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onDur = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);
      if (isRecordingRef.current) finishRecordingRef.current();
    };
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl]);

  const projectRef = useRef(project);
  projectRef.current = project;

  const timelineBpmRef = useRef<number | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const newBpm = (e as CustomEvent).detail as number | null;
      timelineBpmRef.current = newBpm;
      if (newBpm && newBpm > 0 && id) {
        const currentSaved = projectRef.current?.detectedBpm;
        if (currentSaved !== newBpm) {
          updateProjectDataRef.current({ detectedBpm: newBpm } as any);
        }
      }
    };
    window.addEventListener("timeline-bpm-change", handler);
    return () => window.removeEventListener("timeline-bpm-change", handler);
  }, [id]);

  const timelineSnapRef = useRef(true);
  useEffect(() => {
    const handler = (e: Event) => {
      timelineSnapRef.current = (e as CustomEvent).detail;
    };
    window.addEventListener("timeline-snap-change", handler);
    return () => window.removeEventListener("timeline-snap-change", handler);
  }, []);

  const timelineQuantizeDivRef = useRef<2 | 4>(2);
  useEffect(() => {
    const handler = (e: Event) => {
      timelineQuantizeDivRef.current = (e as CustomEvent).detail;
    };
    window.addEventListener("timeline-quantize-div-change", handler);
    return () => window.removeEventListener("timeline-quantize-div-change", handler);
  }, []);

  const startRafLoop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let lastStateUpdate = 0;
    const STATE_INTERVAL = 33;
    const tick = (now: number) => {
      if (!isPlayingRef.current) return;
      if (audio.currentTime > 0) currentTimeRef.current = audio.currentTime;
      if (now - lastStateUpdate >= STATE_INTERVAL) {
        lastStateUpdate = now;
        setCurrentTime(audio.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (isPlayingRef.current) {
      audio.pause();
      isPlayingRef.current = false;
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      const trimStart = projectRef.current?.audioTrimStart ?? 0;
      if (trimStart > 0 && audio.currentTime < trimStart) {
        audio.currentTime = trimStart;
        currentTimeRef.current = trimStart;
      }
      isPlayingRef.current = true;
      safePlay().catch(() => {
        isPlayingRef.current = false;
        cancelAnimationFrame(rafRef.current);
        setIsPlaying(false);
      });
      startRafLoop();
      setIsPlaying(true);
    }
  }, [startRafLoop]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    isPlayingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    const trimStart = projectRef.current?.audioTrimStart ?? 0;
    audio.currentTime = trimStart;
    currentTimeRef.current = trimStart;
    setCurrentTime(trimStart);
  }, []);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = audio.duration || Infinity;
    if (time <= dur) {
      audio.currentTime = time;
    }
    currentTimeRef.current = time;
    setCurrentTime(time);
    window.dispatchEvent(new CustomEvent("timeline-scroll-to-time", { detail: time }));
  }, []);

  const findActiveLineIndex = useCallback((lines: LyricLine[], time: number): number => {
    let bestIdx = -1;
    let bestDur = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startTime === null || l.endTime === null) continue;
      if (time >= l.startTime && time < l.endTime) {
        const dur = l.endTime - l.startTime;
        if (bestIdx === -1 || dur < bestDur || (dur === bestDur && i > bestIdx)) {
          bestIdx = i;
          bestDur = dur;
        }
      }
    }
    return bestIdx;
  }, []);

  const activeLyricIndex = useMemo(() => {
    if (!lyrics) return -1;
    return findActiveLineIndex(lyrics, currentTime);
  }, [lyrics, currentTime, findActiveLineIndex]);

  const activeDisplayIndex = useMemo(() => {
    if (!lyrics) return -1;
    if (activeLyricIndex >= 0) {
      let displayIdx = 0;
      for (let i = 0; i < lyrics.length; i++) {
        if (i > 0 && lyrics[i].blankBefore) displayIdx++;
        if (i === activeLyricIndex) return displayIdx;
        displayIdx++;
      }
      return -1;
    }
    const timed = lyrics.filter(l => l.startTime !== null && l.endTime !== null).sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    for (let ti = 0; ti < timed.length - 1; ti++) {
      const prev = timed[ti];
      const next = timed[ti + 1];
      if (prev.endTime !== null && next.startTime !== null && currentTime >= prev.endTime && currentTime < next.startTime) {
        const nextIdx = lyrics.indexOf(next);
        if (nextIdx > 0 && lyrics[nextIdx].blankBefore) {
          let displayIdx = 0;
          for (let i = 0; i < nextIdx; i++) {
            if (i > 0 && lyrics[i].blankBefore) displayIdx++;
            displayIdx++;
          }
          return displayIdx;
        }
      }
    }
    return -1;
  }, [lyrics, activeLyricIndex, currentTime]);

  const displayToLyricMap = useMemo(() => {
    if (!lyrics) return new Map<number, number>();
    const map = new Map<number, number>();
    let displayIdx = 0;
    for (let i = 0; i < lyrics.length; i++) {
      if (i > 0 && lyrics[i].blankBefore) displayIdx++;
      map.set(displayIdx, i);
      displayIdx++;
    }
    return map;
  }, [lyrics]);

  const activeLineFontSizeHeader = useMemo(() => {
    if (!lyrics || activeLyricIndex < 0) return null;
    return lyrics[activeLyricIndex]?.fontSize ?? null;
  }, [lyrics, activeLyricIndex]);

  useEffect(() => {
    if (isRecording || activeDisplayIndex < 0) return;
    const lineH = 26;
    const ta = lyricsTextareaRef.current;
    if (ta) {
      const targetTop = activeDisplayIndex * lineH;
      const viewH = ta.clientHeight;
      if (targetTop < ta.scrollTop || targetTop + lineH > ta.scrollTop + viewH) {
        const newScroll = Math.max(0, targetTop - viewH / 2 + lineH / 2);
        ta.scrollTop = newScroll;
        if (gutterRef.current) gutterRef.current.scrollTop = newScroll;
        setLyricsScrollTop(newScroll);
      }
    }
  }, [activeDisplayIndex, isRecording]);

  const clearCountdownInterval = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearCountdownInterval();
  }, [clearCountdownInterval]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    if (!audioUrl || !lyrics || lyrics.length === 0) return;
    const audio = audioRef.current;
    if (!audio) return;
    clearCountdownInterval();
    const trimStart = project?.audioTrimStart ?? 0;
    setRecordingTimings(lyrics.map((l) => ({ id: l.id, startTime: null, endTime: null })));

    const lyricIds = lyrics.map((l) => l.id);
    const oldTimings = lyrics.map((l) => ({ id: l.id, startTime: l.startTime, endTime: l.endTime }));
    const oldFades = lyrics.map((l) => ({ id: l.id, fadeIn: l.fadeIn ?? 0, fadeOut: l.fadeOut ?? 0 }));
    const oldFontSizes = lyrics.map((l) => ({ id: l.id, fontSize: (l as any).fontSize ?? null }));
    storage.resetLyricTimingsAndFades(lyricIds).then(() => {
      loadLyrics();
      pushUndo({
        description: "タイミングリセット（録音開始）",
        undo: async () => {
          await storage.restoreLyricTimingsAndFades(
            oldTimings.map(o => ({ id: o.id, startTime: o.startTime, endTime: o.endTime })),
            oldFades,
            oldFontSizes
          );
          loadLyrics();
        },
        redo: async () => {
          await storage.resetLyricTimingsAndFades(lyricIds);
          loadLyrics();
        },
      });
    }).catch(() => {});

    audio.currentTime = trimStart;
    const beginCountdown = () => {
      audio.pause();
      audio.currentTime = trimStart;
      audio.volume = 0;
      setCountdown(3);
      let count = 3;
      countdownIntervalRef.current = setInterval(() => {
        count--;
        if (count > 0) {
          setCountdown(count);
        } else {
          clearCountdownInterval();
          setCountdown(null);
          setRecordingIndex(-2);
          setIsRecording(true);
          isRecordingRef.current = true;
          syncService.setRecording(true);
          isPlayingRef.current = true;
          startRafLoop();
          audio.currentTime = trimStart;
          audio.volume = volumeRef.current;
          safePlay().catch(() => {
            isPlayingRef.current = false;
            cancelAnimationFrame(rafRef.current);
          });
          setIsPlaying(true);
        }
      }, 1000);
    };
    audio.volume = 0;
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = trimStart;
      beginCountdown();
    }).catch(() => {
      beginCountdown();
    });
  }, [audioUrl, lyrics, audioRef, clearCountdownInterval, project?.audioTrimStart, startRafLoop, loadLyrics]);

  const snapToGrid = useCallback((time: number): number => {
    if (!timelineSnapRef.current) return time;
    const bpm = timelineBpmRef.current || projectRef.current?.detectedBpm;
    if (!bpm || bpm <= 0) return time;
    const snapInterval = 60 / bpm / timelineQuantizeDivRef.current;
    const offset = projectRef.current?.bpmGridOffset ?? 0;
    const rel = time - offset;
    const snapped = Math.round(rel / snapInterval) * snapInterval + offset;
    return Math.max(0, snapped);
  }, []);

  const advanceLine = useCallback(() => {
    if (!isRecording || !lyrics) return;
    const audio = audioRef.current;
    if (!audio) return;
    const rawTime = audio.currentTime;
    const time = snapToGrid(rawTime);

    if (recordingIndex === -2) {
      setRecordingTimings((prev) => {
        const next = [...prev];
        next[0] = { ...next[0], startTime: time };
        return next;
      });
      setRecordingIndex(0);
      return;
    }

    const advanceTo = recordingIndex + 1;

    setRecordingTimings((prev) => {
      const next = [...prev];
      if (recordingIndex >= 0 && recordingIndex < next.length) {
        next[recordingIndex] = { ...next[recordingIndex], endTime: time };
      }
      if (advanceTo < next.length) {
        next[advanceTo] = { ...next[advanceTo], startTime: time };
      }
      return next;
    });

    if (advanceTo >= lyrics.length) {
      finishRecordingRef.current();
    } else {
      setRecordingIndex(advanceTo);
    }
  }, [isRecording, recordingIndex, lyrics, snapToGrid]);

  const pendingSaveRef = useRef(false);
  const finishRecording = useCallback(() => {
    clearCountdownInterval();
    setCountdown(null);
    const audio = audioRef.current;
    if (audio) {
      const time = audio.currentTime;
      setRecordingTimings((prev) => {
        const next = [...prev];
        for (let i = 0; i < next.length; i++) {
          if (next[i].startTime !== null && next[i].endTime === null) {
            next[i] = { ...next[i], endTime: time };
          }
        }
        return next;
      });
      audio.pause();
    }
    pendingSaveRef.current = true;
    isPlayingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setIsRecording(false);
    isRecordingRef.current = false;
  }, [audioRef, clearCountdownInterval]);

  useEffect(() => {
    if (pendingSaveRef.current && !isRecording) {
      pendingSaveRef.current = false;
      const timingsToSave = recordingTimings.filter((t) => t.startTime !== null);
      if (timingsToSave.length > 0) {
        updateTimings(timingsToSave);
      }
      setRecordingTimings([]);
      syncService.setRecording(false);
    }
  }, [isRecording, recordingTimings, updateTimings]);

  useEffect(() => {
    if (isRecording && recordingIndex >= 0 && recordingScrollRef.current) {
      const container = recordingScrollRef.current;
      const activeEl = container.querySelector(`[data-rec-idx="${recordingIndex}"]`) as HTMLElement | null;
      if (activeEl) {
        const elTop = activeEl.offsetTop;
        const elH = activeEl.offsetHeight;
        const cH = container.clientHeight;
        const target = elTop - cH / 2 + elH / 2;
        container.scrollTop = Math.max(0, target);
      }
    }
  }, [recordingIndex, isRecording]);

  const advanceLineRef = useRef(advanceLine);
  advanceLineRef.current = advanceLine;
  const finishRecordingRef = useRef(finishRecording);
  finishRecordingRef.current = finishRecording;
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") ||
        !!target.closest("[contenteditable]");

      const isNumberInput = target.tagName === "INPUT" && (target as HTMLInputElement).type === "number";

      const km = keyMapRef.current;

      if (e.code === km.marker && !e.metaKey && !e.ctrlKey && !isTextInput) {
        e.preventDefault();
        let t = currentTimeRef.current;
        const currentBpm = projectRef.current?.detectedBpm;
        if (currentBpm && currentBpm > 0) {
          const qDiv = (window as any).__telopQuantizeDiv || 2;
          const snapInterval = 60 / currentBpm / qDiv;
          const offset = (window as any).__telopGridOffset || 0;
          const rel = t - offset;
          t = Math.round(rel / snapInterval) * snapInterval + offset;
          t = Math.max(0, t);
        }
        const markerId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setCheckMarkers(prev => [...prev, { id: markerId, time: t }]);
        return;
      }

      if (isRecordingRef.current) {
        if (e.code === "Space" || e.code === "ArrowRight" || e.code === "Enter") {
          e.preventDefault();
          if (isTextInput) (target as HTMLElement).blur();
          advanceLineRef.current();
        }
        if (e.code === "Escape") {
          e.preventDefault();
          finishRecordingRef.current();
        }
        return;
      }

      if (e.code === km.playPause) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        togglePlayRef.current();
        return;
      }
      if (e.code === km.seekStart && !e.metaKey && !e.ctrlKey) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        seekTo(0);
        return;
      }
      if (e.code === km.zoomOut && !e.metaKey && !e.ctrlKey) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        window.dispatchEvent(new CustomEvent("timeline-zoom", { detail: "out" }));
        window.dispatchEvent(new CustomEvent("zoom-key", { detail: { key: "a", pressed: true } }));
        return;
      }
      if (e.code === km.zoomIn && !e.metaKey && !e.ctrlKey) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        window.dispatchEvent(new CustomEvent("timeline-zoom", { detail: "in" }));
        window.dispatchEvent(new CustomEvent("zoom-key", { detail: { key: "d", pressed: true } }));
        return;
      }

      if (e.code === km.fullscreen && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextInput) {
        e.preventDefault();
        setPreviewFullscreen(prev => !prev);
        return;
      }

      if (e.code === km.fadeMode && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextInput) {
        e.preventDefault();
        if (!e.repeat) {
          window.dispatchEvent(new CustomEvent("timeline-fade-mode-on"));
        }
        return;
      }

      if (e.code === km.seekBack && !e.metaKey && !e.ctrlKey) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        const bpmVal = timelineBpmRef.current || projectRef.current?.detectedBpm;
        if (bpmVal && bpmVal > 0) {
          const offset = projectRef.current?.bpmGridOffset ?? 0;
          const barDuration = (60 / bpmVal) * 4;
          const relTime = currentTimeRef.current - offset;
          const currentBarIdx = Math.round(relTime / barDuration);
          const currentBarStart = currentBarIdx * barDuration + offset;
          const epsilon = 0.01;
          const target = (currentTimeRef.current - currentBarStart) > epsilon
            ? currentBarStart
            : (currentBarIdx - 1) * barDuration + offset;
          seekTo(Math.max(0, target));
        }
        return;
      }
      if (e.code === km.seekForward && !e.metaKey && !e.ctrlKey) {
        if (isTextInput && !isNumberInput) return;
        e.preventDefault();
        if (isNumberInput) (target as HTMLElement).blur();
        const bpmVal = timelineBpmRef.current || projectRef.current?.detectedBpm;
        if (bpmVal && bpmVal > 0) {
          const offset = projectRef.current?.bpmGridOffset ?? 0;
          const barDuration = (60 / bpmVal) * 4;
          const relTime = currentTimeRef.current - offset;
          const currentBarIdx = Math.round(relTime / barDuration);
          const nextBarTime = (currentBarIdx + 1) * barDuration + offset;
          seekTo(nextBarTime);
        }
        return;
      }

    if ((e.code === km.titleIn || e.code === km.title2In) && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextInput) {
      e.preventDefault();
      const layoutNum = e.code === km.title2In ? 2 : 1;
      const proj = projectRef.current;
      const dur = audioRef.current?.duration || 0;
      if (!proj || dur <= 0) return;
      
      const isAlreadyActive = proj.creditInTime != null && (proj.creditTitleLayout ?? 1) === layoutNum;

      if (isAlreadyActive) {
        updateProjectDataRef.current({ creditInTime: null, creditOutTime: null, creditAnimDuration: null, creditHoldStartMs: null, creditWipeStartMs: null, creditTitleLayout: 1 } as any);
      } else {
        const bpm = timelineBpmRef.current || proj.detectedBpm;
        const beatMs = bpm && bpm > 0 ? (60 / bpm) * 1000 : null;
        const baseAnimDur = beatMs ? beatMs * 16 : 6700;
        const defaultWipeMs = beatMs ? beatMs * 12 : baseAnimDur * 3 / 4;
        let inTime = snapToGrid(Math.max(0, currentTimeRef.current));
        const outTime = calcCreditOutTime(dur, baseAnimDur);
        updateProjectDataRef.current({ creditInTime: inTime, creditOutTime: outTime, creditAnimDuration: baseAnimDur, creditWipeStartMs: defaultWipeMs, creditTitleLayout: layoutNum } as any);
      }
      return;
    }

      if ((e.code === "Delete" || e.code === "Backspace") && !isTextInput) {
        window.dispatchEvent(new CustomEvent("delete-selected-markers"));
        return;
      }

      if (isTextInput) return;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const km = keyMapRef.current;
      if (e.code === km.zoomOut) {
        window.dispatchEvent(new CustomEvent("zoom-key", { detail: { key: "a", pressed: false } }));
      }
      if (e.code === km.zoomIn) {
        window.dispatchEvent(new CustomEvent("zoom-key", { detail: { key: "d", pressed: false } }));
      }
      if (e.code === km.fadeMode) {
        window.dispatchEvent(new CustomEvent("timeline-fade-mode-off"));
      }
      if (e.code === "Space") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const deleteSelectedBlocksRef = useRef<() => Promise<boolean>>(async () => false);
  deleteSelectedBlocksRef.current = async () => {
    const selIds = timelineSelectedIdsRef.current;
    if (selIds.size === 0 || !lyrics) return false;
    const selectedLines = lyrics.filter(l => selIds.has(l.id) && l.startTime !== null);
    if (selectedLines.length === 0) return false;
    const ids = selectedLines.map(l => l.id);
    const oldTimings = selectedLines.map(l => ({ id: l.id, startTime: l.startTime, endTime: l.endTime }));
    const oldFades = selectedLines.map(l => ({ id: l.id, fadeIn: l.fadeIn ?? 0, fadeOut: l.fadeOut ?? 0 }));
    const oldFontSizes = selectedLines.map(l => ({ id: l.id, fontSize: (l as any).fontSize ?? null }));
    await storage.resetLyricTimingsAndFades(ids);
    loadLyrics();
    pushUndo({
      description: "タイミングカット",
      undo: async () => {
        await storage.restoreLyricTimingsAndFades(oldTimings, oldFades, oldFontSizes);
        loadLyrics();
        if (projectRef.current?.id) syncService.schedulePush(projectRef.current.id);
      },
      redo: async () => {
        await storage.resetLyricTimingsAndFades(ids);
        loadLyrics();
        if (projectRef.current?.id) syncService.schedulePush(projectRef.current.id);
      },
    });
    if (projectRef.current?.id) syncService.schedulePush(projectRef.current.id);
    setTimelineSelectedIds(new Set());
    return true;
  };

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") ||
        !!target.closest("[contenteditable]");
      if (isTextInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "x" && !e.shiftKey) {
        e.preventDefault();
        await deleteSelectedBlocksRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const d = await undoRef.current();
        if (d) toastRef.current({ title: `元に戻しました: ${d}` });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        const d = await redoRef.current();
        if (d) toastRef.current({ title: `やり直しました: ${d}` });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const outputW = project?.outputWidth || 1920;
  const outputH = project?.outputHeight || 1080;

  const lastPreviewSizeRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const wrapper = previewWrapperRef.current;
    if (!wrapper) return;
    const aspectRatio = outputW / outputH;
    let retryRaf: number | null = null;
    let retryCount = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const computeSize = () => {
      const cs = getComputedStyle(wrapper);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      const availW = wrapper.clientWidth - padL - padR;
      const availH = wrapper.clientHeight - padT - padB;
      if (availW <= 0 || availH <= 0) {
        if (retryCount < 10) {
          retryCount++;
          retryRaf = requestAnimationFrame(computeSize);
        }
        return;
      }
      let w: number, h: number;
      if (availW / availH > aspectRatio) {
        h = availH;
        w = h * aspectRatio;
      } else {
        w = availW;
        h = w / aspectRatio;
      }
      const nw = Math.floor(w);
      const nh = Math.floor(h);
      const prev = lastPreviewSizeRef.current;
      if (!prev || Math.abs(prev.width - nw) > 1 || Math.abs(prev.height - nh) > 1) {
        lastPreviewSizeRef.current = { width: nw, height: nh };
        setPreviewSize({ width: nw, height: nh });
      }
    };
    retryRaf = requestAnimationFrame(computeSize);
    const ro = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(computeSize, 50);
    });
    ro.observe(wrapper);
    return () => {
      ro.disconnect();
      if (retryRaf !== null) cancelAnimationFrame(retryRaf);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [outputW, outputH, projectLoading]);

  const fontSize = project?.fontSize || 48;
  const fontFamily = project?.fontFamily || "Noto Sans JP";
  const JP_FALLBACK = "Noto Sans JP";
  const lyricsTextForFont = useMemo(() => {
    if (!lyrics || lyrics.length === 0) return "";
    const chars = new Set<string>();
    for (const l of lyrics) {
      for (const ch of l.text) chars.add(ch);
    }
    return Array.from(chars).join("");
  }, [lyrics]);
  useEffect(() => {
    if (!fontFamily) return;
    const testStr = "？！…「」『』（）〜・あいうえおアイウエオ漢字ABCabc123" + lyricsTextForFont;
    const loads = [document.fonts.load(`bold 48px "${fontFamily}"`, testStr)];
    if (fontFamily !== JP_FALLBACK) {
      loads.push(document.fonts.load(`bold 48px "${JP_FALLBACK}"`, testStr));
    }
    Promise.all(loads).then(() => {
      setFontLoaded((c) => c + 1);
    });
  }, [fontFamily, lyricsTextForFont]);
  const fontColor = project?.fontColor || "#FFFFFF";
  const strokeColorVal = project?.strokeColor || "#000000";
  const strokeWidthVal = project?.strokeWidth ?? 8;
  const strokeBlurVal = project?.strokeBlur ?? 0;
  const textAlign = (project?.textAlign as CanvasTextAlign) || "center";
  const textXPos = project?.textX;
  const textYPos = project?.textY;
  const preset = project?.preset || "other";
  const accentHue = 0;
  const accent = {
    bg12: `hsla(0, 0%, 13%, 0.9)`,
    border40: `hsl(0, 0%, 40%)`,
    border25: `hsl(0 0% 30%)`,
    borderSub20: `hsl(0 0% 26%)`,
    gradBg: `hsla(0, 0%, 18%, 0.4)`,
    icon60: `hsl(0 0% 62%)`,
    label58: `hsl(0 0% 62%)`,
    solid55: `hsl(0 0% 55%)`,
    bright75: `hsl(0 0% 75%)`,
    mid60: `hsl(0 0% 62%)`,
    light72: `hsl(0 0% 68%)`,
    block45: `hsl(0, 0%, 45%)`,
  };
  const [presetVersion, setPresetVersion] = useState(0);
  const PRESETS = useMemo(() => getPresets(), [presetVersion]);
  const activePreset = PRESETS[preset] || PRESETS.other;
  const creditLineY = project?.creditLineY ?? 80;
  
  useEffect(() => {
    demoLineYRef.current = creditLineY;
  }, [creditLineY]);
  const motifColor = project?.motifColor || "#4466FF";
  const songTitle = project?.songTitle || "";
  const lyricsCredit = project?.lyricsCredit || "";
  const musicCredit = project?.musicCredit || "";
  const arrangementCredit = project?.arrangementCredit || "";
  const membersCredit = project?.membersCredit || "";

  const [localSongTitle, setLocalSongTitle] = useState<string | null>(null);
  const [localProjectName, setLocalProjectName] = useState<string | null>(null);
  const [localLyricsCredit, setLocalLyricsCredit] = useState<string | null>(null);
  const [localMusicCredit, setLocalMusicCredit] = useState<string | null>(null);
  const [localArrangementCredit, setLocalArrangementCredit] = useState<string | null>(null);
  const [localMembersCredit, setLocalMembersCredit] = useState<string | null>(null);
  const creditDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const creditPendingRef = useRef<Record<string, { field: string; value: string }>>({});
  const debouncedCreditSave = useCallback((field: string, value: string) => {
    creditPendingRef.current[field] = { field, value };
    if (creditDebounceRef.current[field]) clearTimeout(creditDebounceRef.current[field]);
    creditDebounceRef.current[field] = setTimeout(async () => {
      delete creditPendingRef.current[field];
      const payload: Record<string, any> = { [field]: value };
      await storage.updateProject(id!, payload);
      syncService.schedulePush(id!);
    }, 800);
  }, [id]);
  const flushCreditSave = useCallback(async (field: string) => {
    const pending = creditPendingRef.current[field];
    if (pending) {
      if (creditDebounceRef.current[field]) clearTimeout(creditDebounceRef.current[field]);
      delete creditPendingRef.current[field];
      const payload: Record<string, any> = { [pending.field]: pending.value };
      await storage.updateProject(id!, payload);
      syncService.schedulePush(id!);
    }
  }, [id]);
  const effectiveSongTitle = localSongTitle ?? songTitle;
  const effectiveLyricsCredit = localLyricsCredit ?? lyricsCredit;
  const effectiveMusicCredit = localMusicCredit ?? musicCredit;
  const effectiveArrangementCredit = localArrangementCredit ?? arrangementCredit;
  const effectiveMembersCredit = localMembersCredit ?? membersCredit;
  const effectiveRightTitle = effectiveSongTitle;
  const activeText = useMemo(() => {
    if (isRecording) {
      return "";
    }
    return activeLyricIndex >= 0 && lyrics ? lyrics[activeLyricIndex].text : "";
  }, [isRecording, activeLyricIndex, lyrics]);
  const calcFadeOpacity = useCallback((time: number) => {
    if (!lyrics) return 1;
    let line;
    if (isRecording) {
      if (recordingIndex < 0 || recordingIndex >= lyrics.length) return 1;
      line = lyrics[recordingIndex];
    } else {
      const idx = findActiveLineIndex(lyrics, time);
      line = idx >= 0 ? lyrics[idx] : null;
    }
    if (!line || line.startTime === null || line.endTime === null) return 1;
    const fi = line.fadeIn ?? 0;
    const fo = line.fadeOut ?? 0;
    const elapsed = time - line.startTime;
    const remaining = line.endTime - time;
    if (fi > 0 && elapsed < fi) return Math.max(0, elapsed / fi);
    if (fo > 0 && remaining < fo) return Math.max(0, remaining / fo);
    return 1;
  }, [lyrics, isRecording, recordingIndex, findActiveLineIndex]);

  const [showCreditMode, setShowCreditMode] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [lyricsFullscreen, setLyricsFullscreen] = useState(false);
  const [minimalMode, setMinimalMode] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(520);
  const isDraggingDividerRef = useRef(false);
  const dividerStartXRef = useRef(0);
  const dividerStartWidthRef = useRef(680);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const dragTextRef = useRef({ startMouseX: 0, startMouseY: 0, startTextX: 0, startTextY: 0 });

  const [localTextX, setLocalTextX] = useState<number | null>(null);
  const [localTextY, setLocalTextY] = useState<number | null>(null);
  const [localFontSize, setLocalFontSize] = useState<number | null>(null);
  const [localCreditLineY, setLocalCreditLineY] = useState<number | null>(null);
  const effectiveCreditLineY = localCreditLineY ?? creditLineY;
  const [localFontColor, setLocalFontColor] = useState<string | null>(null);
  const [localStrokeColor, setLocalStrokeColor] = useState<string | null>(null);
  const [localMotifColor, setLocalMotifColor] = useState<string | null>(null);
  const colorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creditLineYDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDragPos = useRef<{ x: number; y: number } | null>(null);
  const fontSizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveTextX = localTextX ?? textXPos;
  const effectiveTextY = localTextY ?? textYPos;
  const effectiveFontSize = localFontSize ?? fontSize;
  const effectiveFontColor = localFontColor ?? fontColor;
  const effectiveStrokeColor = localStrokeColor ?? strokeColorVal;
  const effectiveMotifColor = localMotifColor ?? motifColor;

  const getDefaultTextX = () => {
    if (textAlign === "left") return 40;
    if (textAlign === "right") return outputW - 40;
    return outputW / 2;
  };
  const getDefaultTextY = () => outputH * 0.8;

  const [previewBgMode, setPreviewBgMode] = useState<"checker" | "color">("checker");
  const checkerPatternRef = useRef<ImageData | null>(null);
  const checkerSizeRef = useRef({ w: 0, h: 0, mode: "" as string });

  useEffect(() => {
    const key = `${outputW}_${outputH}_${previewBgMode}_${accentHue}`;
    if (checkerPatternRef.current && checkerSizeRef.current.mode === key) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = outputW;
    offscreen.height = outputH;
    const offCtx = offscreen.getContext("2d")!;
    if (previewBgMode === "color") {
      offCtx.fillStyle = "hsl(0, 0%, 35%)";
      offCtx.fillRect(0, 0, outputW, outputH);
    } else {
      offCtx.fillStyle = "rgba(0,0,0,0.15)";
      offCtx.fillRect(0, 0, outputW, outputH);
      const checkerSize = 12;
      offCtx.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 0; y < outputH; y += checkerSize * 2) {
        for (let x = 0; x < outputW; x += checkerSize * 2) {
          offCtx.fillRect(x, y, checkerSize, checkerSize);
          offCtx.fillRect(x + checkerSize, y + checkerSize, checkerSize, checkerSize);
        }
      }
    }
    checkerPatternRef.current = offCtx.getImageData(0, 0, outputW, outputH);
    checkerSizeRef.current = { w: outputW, h: outputH, mode: key };
  }, [outputW, outputH, previewBgMode, accentHue]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.width !== outputW || canvas.height !== outputH) {
      canvas.width = outputW;
      canvas.height = outputH;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.setLineDash([]);
    if (checkerPatternRef.current) {
      ctx.putImageData(checkerPatternRef.current, 0, 0);
    } else {
      ctx.clearRect(0, 0, outputW, outputH);
    }

    const now = currentTimeRef.current;
    const fadeOpacity = calcFadeOpacity(now);

    const lyricsSource = editedLyrics || lyrics;
    let realActiveText = "";
    let activeLineFontSize: number | null = null;
    if (lyricsSource) {
      if (isRecording) {
        let recActiveIdx = -1;
        if (recordingIndex >= 0 && recordingIndex < lyricsSource.length) {
          const rt = recordingTimings[recordingIndex];
          if (rt && rt.startTime !== null) {
            recActiveIdx = recordingIndex;
          }
        }
        for (let i = 0; i < recordingIndex; i++) {
          const rt = recordingTimings[i];
          if (rt && rt.startTime !== null && rt.endTime !== null && now >= rt.startTime && now < rt.endTime) {
            recActiveIdx = i;
          }
        }
        if (recActiveIdx >= 0) {
          realActiveText = lyricsSource[recActiveIdx].text;
          activeLineFontSize = lyricsSource[recActiveIdx].fontSize ?? null;
        }
      } else {
        const activeIdx = findActiveLineIndex(lyricsSource, now);
        if (activeIdx >= 0) {
          realActiveText = lyricsSource[activeIdx].text;
          activeLineFontSize = lyricsSource[activeIdx].fontSize ?? null;
        }
      }
    }

    const creditIn = project?.creditInTime ?? null;
    const creditOut = project?.creditOutTime ?? null;
    const DEFAULT_CREDIT_ANIM_MS = 6700;
    const rawCreditAnimDurMs = project?.creditAnimDuration ?? DEFAULT_CREDIT_ANIM_MS;
    const animScale = rawCreditAnimDurMs / DEFAULT_CREDIT_ANIM_MS;
    const outAnimDur = 1.5 * animScale;
    const currentLayoutForTiming = project?.creditTitleLayout ?? 1;
    const customWipeStartMsForTiming = project?.creditWipeStartMs;
    const wipeStartForTiming = customWipeStartMsForTiming ?? Math.round(rawCreditAnimDurMs * 3 / 4);
    const wipeDurForTiming = Math.round(rawCreditAnimDurMs * 0.5);
    const rtTextForTiming = (effectiveRightTitle || songTitle || "").trim();
    const rtCharDelayForTiming = activePreset.creditRightCharDelay * animScale;
    const rtCharAnimDurForTiming = activePreset.creditRightCharAnimDur * animScale;
    const rtTotalDurForTiming = rtTextForTiming.length > 0
      ? ((rtTextForTiming.length - 1) * rtCharDelayForTiming + rtCharAnimDurForTiming + 500)
      : 0;
    const fullCreditDurMs = wipeStartForTiming + wipeDurForTiming + rtTotalDurForTiming;
    const fullCreditDurSec = fullCreditDurMs / 1000;
    const isCreditActiveByTiming = creditIn !== null && now >= creditIn && (creditOut !== null ? now < creditOut + outAnimDur : now < creditIn + fullCreditDurSec);
    const isPlayingOrRecording = isPlayingRef.current || isRecording;
    const isPastCreditOut = creditOut !== null && now >= creditOut;
    const hasCreditTiming = creditIn !== null;
    const shouldShowCredit = isPlayingOrRecording
      ? isCreditActiveByTiming
      : hasCreditTiming
        ? (isCreditActiveByTiming && !isPastCreditOut) || (showCreditMode && !realActiveText)
        : showCreditMode;

    const hasCreditContent = songTitle || lyricsCredit || musicCredit || arrangementCredit || membersCredit || showCreditMode;
    if (shouldShowCredit && hasCreditContent) {
      const isAnimating = isCreditActiveByTiming && creditIn !== null;
      const elapsedMs = isAnimating ? (now - creditIn) * 1000 : -1;
      const isPastCreditOut = creditOut !== null && now >= creditOut;
      const isStaticPreview = showCreditMode && !isAnimating && !isPastCreditOut;

      const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
      const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

      const lineY = outputH * (demoLineYRef.current / 100);
      const creditBaseX = outputW * activePreset.creditBaseXRatio;

      const cTitleSize = project?.creditTitleFontSize ?? 64;
      const cLyricsSize = project?.creditLyricsFontSize ?? 36;
      const cMusicSize = project?.creditMusicFontSize ?? 36;
      const cArrangeSize = project?.creditArrangementFontSize ?? 36;
      const cMembersSize = project?.creditMembersFontSize ?? 36;
      const cRightTitleSize = project?.creditRightTitleFontSize ?? 38;
      const creditWeight = activePreset.creditFontWeight;

      if (isStaticPreview) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = strokeWidthVal > 0 ? Math.max(1, Math.round(strokeWidthVal * 0.4)) : 3;
        if (strokeBlurVal > 0) {
          ctx.shadowColor = "rgba(255,255,255,0.5)";
          ctx.shadowBlur = strokeBlurVal;
        }
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(outputW, lineY);
        ctx.stroke();
        ctx.restore();

        const drawCreditText = (text: string, x: number, y: number, font: string, align: CanvasTextAlign, baseline: CanvasTextBaseline, color: string) => {
          const fontSizeMatch = font.match(/(\d+)px/);
          const thisFontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 72;
          const scaledStrokeW = strokeWidthVal * (thisFontSize / 72);
          const scaledBlur = strokeBlurVal;
          ctx.save();
          ctx.font = font;
          ctx.textAlign = align;
          ctx.textBaseline = baseline;
          if (scaledStrokeW > 0) {
            ctx.strokeStyle = effectiveStrokeColor;
            ctx.lineWidth = scaledStrokeW;
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            if (scaledBlur > 0) {
              ctx.shadowColor = effectiveStrokeColor;
              ctx.shadowBlur = scaledBlur;
            }
            ctx.strokeText(text, x, y);
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = color;
          ctx.fillText(text, x, y);
          ctx.restore();
        };

        const currentLayoutStatic = project?.creditTitleLayout ?? 1;
        const bigFont = `bold ${cTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
        drawCreditText(songTitle, creditBaseX, lineY - 12, bigFont, "left", "bottom", effectiveFontColor);

        const creditParts: { text: string; size: number }[] = [];
        if (effectiveLyricsCredit) creditParts.push({ text: `作詞：${effectiveLyricsCredit}`, size: cLyricsSize });
        const sameComposer = effectiveMusicCredit && effectiveArrangementCredit && effectiveMusicCredit.trim() === effectiveArrangementCredit.trim();
        if (sameComposer) {
          creditParts.push({ text: `作曲/編曲：${effectiveMusicCredit}`, size: cMusicSize });
        } else {
          if (effectiveMusicCredit) creditParts.push({ text: `作曲：${effectiveMusicCredit}`, size: cMusicSize });
          if (effectiveArrangementCredit) creditParts.push({ text: `編曲：${effectiveArrangementCredit}`, size: cArrangeSize });
        }

        if (currentLayoutStatic === 2) {
          ctx.font = bigFont;
          const titleWidth = ctx.measureText(songTitle || "").width;
          const gap = cTitleSize * 0.6;
          const rightBaseX = creditBaseX + titleWidth + gap;

          const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          const memberText = effectiveMembersCredit ? effectiveMembersCredit.split(",").join("  ") : "";
          let nextX = rightBaseX;
          if (memberText) {
            drawCreditText(memberText, nextX, lineY - 12, memFont, "left", "bottom", "rgba(255,255,255,0.9)");
            ctx.font = memFont;
            nextX += ctx.measureText(memberText).width + ctx.measureText("　").width;
          }
          if (creditParts.length > 0) {
            let partX = nextX;
            for (let pi = 0; pi < creditParts.length; pi++) {
              const p = creditParts[pi];
              const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              drawCreditText(p.text, partX, lineY - 12, pFont, "left", "bottom", "rgba(255,255,255,0.9)");
              ctx.font = pFont;
              partX += ctx.measureText(p.text).width;
              if (pi < creditParts.length - 1) partX += ctx.measureText("　").width;
            }
          }
        } else {
          let infoY = lineY + 15;
          if (effectiveMembersCredit) {
            const memberText = effectiveMembersCredit.split(",").join("  ");
            const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
            drawCreditText(memberText, creditBaseX, infoY, memFont, "left", "top", "rgba(255,255,255,0.9)");
            infoY += cMembersSize + 16;
          }
          if (creditParts.length > 0) {
            let partX = creditBaseX;
            for (let pi = 0; pi < creditParts.length; pi++) {
              const p = creditParts[pi];
              const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              drawCreditText(p.text, partX, infoY, pFont, "left", "top", "rgba(255,255,255,0.9)");
              ctx.font = pFont;
              partX += ctx.measureText(p.text).width;
              if (pi < creditParts.length - 1) partX += ctx.measureText("　").width;
            }
          }
        }
      } else if (isAnimating) {
        const drawStrokeTextInline = (
          text: string, x: number, y: number, font: string,
          align: CanvasTextAlign, baseline: CanvasTextBaseline,
          strokeProgress: number, fillProgress: number,
          alpha: number = 1, color: string = effectiveFontColor,
          strokeWidth: number = 1.5,
        ) => {
          const fontSizeMatch = font.match(/(\d+)px/);
          const thisFontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 72;
          const scaledStrokeW = strokeWidthVal * (thisFontSize / 72);
          const scaledBlur = strokeBlurVal;
          ctx.save();
          ctx.font = font;
          ctx.textAlign = align;
          ctx.textBaseline = baseline;
          if (fillProgress > 0) {
            ctx.setLineDash([]);
            ctx.globalAlpha = fillProgress * alpha;
            if (scaledStrokeW > 0) {
              ctx.strokeStyle = effectiveStrokeColor;
              ctx.lineWidth = scaledStrokeW;
              ctx.lineJoin = "round";
              ctx.miterLimit = 2;
              if (scaledBlur > 0) { ctx.shadowColor = effectiveStrokeColor; ctx.shadowBlur = scaledBlur; }
              ctx.strokeText(text, x, y);
              ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
            }
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
          }
          ctx.restore();
        };

        const currentLayout = project?.creditTitleLayout ?? 1;
        const customWipeStartMs = project?.creditWipeStartMs;
        const wipeStart = customWipeStartMs ?? Math.round(rawCreditAnimDurMs * 3 / 4);
        const wipeDur = Math.round(rawCreditAnimDurMs * 0.5);
        const wipeP = clamp01((elapsedMs - wipeStart) / wipeDur);
        const grp1Visible = wipeP < 1;
        const rtCharDelay = activePreset.creditRightCharDelay * animScale;
        const rtCharAnimDur = activePreset.creditRightCharAnimDur * animScale;
        const rightTitleText = (effectiveRightTitle || songTitle || "").trim();
        const rtTotalDur = rightTitleText.length > 0
          ? ((rightTitleText.length - 1) * rtCharDelay + rtCharAnimDur + 500)
          : 0;
        const grp2Start = wipeStart + wipeDur;
        const fullCreditDurMs = wipeStart + wipeDur + rtTotalDur;
        const outAnimDurMs = outAnimDur * 1000;
        let outWipeP = 0;
        if (creditOut !== null && now >= creditOut) {
          outWipeP = easeInOut(clamp01((now - creditOut) * 1000 / outAnimDurMs));
        }

        const barActive = elapsedMs < fullCreditDurMs;
        const isOutAnimating = creditOut !== null && now >= creditOut && now < creditOut + outAnimDur;
        const isHolding = !barActive && creditOut !== null && now < creditOut;
        if (barActive || isHolding || isOutAnimating) {

        const lineDrawn = easeOut(clamp01(elapsedMs / (2000 * animScale)));
        const lineRight = outputW * lineDrawn;
        const lineLeft = outputW * outWipeP;
        if (lineRight > lineLeft) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = strokeWidthVal > 0 ? Math.max(1, Math.round(strokeWidthVal * 0.4)) : 3;
          if (strokeBlurVal > 0) {
            ctx.shadowColor = "rgba(255,255,255,0.5)";
            ctx.shadowBlur = strokeBlurVal;
          }
          ctx.beginPath();
          ctx.moveTo(lineLeft, lineY);
          ctx.lineTo(lineRight, lineY);
          ctx.stroke();
          ctx.restore();
        }

        if (grp1Visible) {
          ctx.save();
          const clipLeftIn = wipeP > 0 ? outputW * wipeP : 0;
          const clipLeftOut = outWipeP > 0 ? outputW * outWipeP : 0;
          const effectiveClipLeft = Math.max(clipLeftIn, clipLeftOut);
          if (effectiveClipLeft > 0) {
            ctx.beginPath();
            ctx.rect(effectiveClipLeft, 0, outputW - effectiveClipLeft, outputH);
            ctx.clip();
          }

        if (currentLayout === 2) {
          const titleFont = `bold ${cTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          ctx.font = titleFont;
          const titleText = songTitle || "";
          const titleWidth = ctx.measureText(titleText).width;
          const gap = cTitleSize * 0.6;
          const rightX = creditBaseX + titleWidth + gap;

          const charDelay = activePreset.creditCharDelay * animScale;
          const charAnimDur = activePreset.creditCharAnimDur * animScale;
          const titleStart = 0;

          if (grp1Visible) {
            let charX = creditBaseX;
            for (let ci = 0; ci < titleText.length; ci++) {
              const ch = titleText[ci];
              const chStart = titleStart + ci * charDelay;
              const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / charAnimDur));
              const chFillP = easeOut(clamp01((elapsedMs - chStart - charAnimDur * 0.7) / (charAnimDur * 0.5)));
              if (chStrokeP > 0) {
                drawStrokeTextInline(ch, charX, lineY - 12, titleFont, "left", "bottom", chStrokeP, chFillP);
              }
              ctx.font = titleFont;
              charX += ctx.measureText(ch).width;
            }

            const titleEndTime = titleStart + (titleText.length - 1) * charDelay + charAnimDur;
            const creditsStart = titleEndTime + 100 * animScale;
            const creditsFillDur = 1200 * animScale;
            const creditsFadeP = easeOut(clamp01((elapsedMs - creditsStart) / creditsFillDur));

            if (creditsFadeP > 0) {
              const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              
              const memberText = effectiveMembersCredit ? effectiveMembersCredit.split(",").join("  ") : "";
              let staffX = rightX;
              if (memberText) {
                ctx.save();
                ctx.globalAlpha = creditsFadeP;
                drawStrokeTextInline(memberText, rightX, lineY - 12, memFont, "left", "bottom", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                ctx.font = memFont;
                staffX = rightX + ctx.measureText(memberText).width + ctx.measureText("　").width;
                ctx.restore();
              }

              const staffParts: { text: string; size: number }[] = [];
              if (effectiveLyricsCredit) staffParts.push({ text: `作詞：${effectiveLyricsCredit}`, size: cLyricsSize });
              const sameComposerAnim = effectiveMusicCredit && effectiveArrangementCredit && effectiveMusicCredit.trim() === effectiveArrangementCredit.trim();
              if (sameComposerAnim) {
                staffParts.push({ text: `作曲/編曲：${effectiveMusicCredit}`, size: cMusicSize });
              } else {
                if (effectiveMusicCredit) staffParts.push({ text: `作曲：${effectiveMusicCredit}`, size: cMusicSize });
                if (effectiveArrangementCredit) staffParts.push({ text: `編曲：${effectiveArrangementCredit}`, size: cArrangeSize });
              }

              if (staffParts.length > 0) {
                ctx.save();
                ctx.globalAlpha = creditsFadeP;
                let partX = staffX;
                for (let pi = 0; pi < staffParts.length; pi++) {
                  const p = staffParts[pi];
                  const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
                  drawStrokeTextInline(p.text, partX, lineY - 12, pFont, "left", "bottom", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                  ctx.font = pFont;
                  partX += ctx.measureText(p.text).width;
                  if (pi < staffParts.length - 1) partX += ctx.measureText("　").width;
                }
                ctx.restore();
              }
            }
          }
        } else {
          const charDelay = activePreset.creditCharDelay * animScale;
          const charAnimDur = activePreset.creditCharAnimDur * animScale;
          const titleStart = 0;

          const bigFont = `bold ${cTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          ctx.font = bigFont;
          let charX = creditBaseX;
          const titleText = songTitle || "";
          for (let ci = 0; ci < titleText.length; ci++) {
            const ch = titleText[ci];
            const chStart = titleStart + ci * charDelay;
            const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / charAnimDur));
            const chFillP = easeOut(clamp01((elapsedMs - chStart - charAnimDur * 0.7) / (charAnimDur * 0.5)));
            if (chStrokeP > 0) {
              drawStrokeTextInline(ch, charX, lineY - 12, bigFont, "left", "bottom", chStrokeP, chFillP);
            }
            ctx.font = bigFont;
            charX += ctx.measureText(ch).width;
          }

          const titleEndTime = titleStart + (titleText.length - 1) * charDelay + charAnimDur;
          const creditsStart = titleEndTime + 100 * animScale;
          const creditsFillDur = 1200 * animScale;
          const creditsFadeP = easeOut(clamp01((elapsedMs - creditsStart) / creditsFillDur));

          if (creditsFadeP > 0) {
            const animCreditParts: { text: string; size: number }[] = [];
            if (effectiveLyricsCredit) animCreditParts.push({ text: `作詞：${effectiveLyricsCredit}`, size: cLyricsSize });
            const sameComposerAnim = effectiveMusicCredit && effectiveArrangementCredit && effectiveMusicCredit.trim() === effectiveArrangementCredit.trim();
            if (sameComposerAnim) {
              animCreditParts.push({ text: `作曲/編曲：${effectiveMusicCredit}`, size: cMusicSize });
            } else {
              if (effectiveMusicCredit) animCreditParts.push({ text: `作曲：${effectiveMusicCredit}`, size: cMusicSize });
              if (effectiveArrangementCredit) animCreditParts.push({ text: `編曲：${effectiveArrangementCredit}`, size: cArrangeSize });
            }

            let infoY = lineY + 15;
            if (effectiveMembersCredit) {
              const memberText = effectiveMembersCredit.split(",").join("  ");
              const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              ctx.save();
              ctx.globalAlpha = creditsFadeP;
              drawStrokeTextInline(memberText, creditBaseX, infoY, memFont, "left", "top", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
              ctx.restore();
              infoY += cMembersSize + 16;
            }
            if (animCreditParts.length > 0) {
              ctx.save();
              ctx.globalAlpha = creditsFadeP;
              let partX = creditBaseX;
              for (let pi = 0; pi < animCreditParts.length; pi++) {
                const p = animCreditParts[pi];
                const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
                drawStrokeTextInline(p.text, partX, infoY, pFont, "left", "top", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                ctx.font = pFont;
                partX += ctx.measureText(p.text).width;
                if (pi < animCreditParts.length - 1) partX += ctx.measureText("　").width;
              }
              ctx.restore();
            }
          }
        }

          ctx.restore();
        }

        if (elapsedMs >= grp2Start && outWipeP < 1) {
          ctx.save();
          if (outWipeP > 0) {
            const clipL = outputW * outWipeP;
            ctx.beginPath();
            ctx.rect(clipL, 0, outputW - clipL, outputH);
            ctx.clip();
          }
          const stFont = `bold ${cRightTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          const stX = outputW - outputW * activePreset.creditRightMarginRatio;
          const stY = lineY - outputH * 0.01;
          const rightTitleText = (effectiveRightTitle || songTitle).trim();

          const baseRtCharDelay = activePreset.creditRightCharDelay * animScale;
          const baseRtCharAnimDur = activePreset.creditRightCharAnimDur * animScale;
          ctx.font = stFont;
          if (rightTitleText.length > 0) {
            const rtCharDelay = baseRtCharDelay;
            const rtCharAnimDur = baseRtCharAnimDur;
            const charWidths: number[] = [];
            for (let ci = 0; ci < rightTitleText.length; ci++) {
              charWidths.push(ctx.measureText(rightTitleText[ci]).width);
            }
            const rightEdges: number[] = [];
            let re = stX;
            for (let ci = rightTitleText.length - 1; ci >= 0; ci--) {
              rightEdges[ci] = re;
              re -= charWidths[ci];
            }
            for (let ci = 0; ci < rightTitleText.length; ci++) {
              const ch = rightTitleText[ci];
              const chStart = grp2Start + ci * rtCharDelay;
              const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / rtCharAnimDur));
              const chFillP = easeOut(clamp01((elapsedMs - chStart - rtCharAnimDur * 0.7) / (rtCharAnimDur * 0.5)));
              if (chStrokeP > 0) {
                drawStrokeTextInline(ch, rightEdges[ci], stY, stFont, "right", "bottom", chStrokeP, chFillP);
              }
            }
          }
          ctx.restore();
        }
        }
      }
    }

    const tx = effectiveTextX ?? getDefaultTextX();
    const ty = effectiveTextY ?? getDefaultTextY();
    if (realActiveText) {
      const lineFontSize = activeLineFontSize ?? effectiveFontSize;
      drawTextWithRuby(ctx, realActiveText, tx, ty, lineFontSize, fontFamily, textAlign, effectiveFontColor, effectiveStrokeColor, strokeWidthVal, fadeOpacity, strokeBlurVal);
    }
  }, [lyrics, editedLyrics, isRecording, recordingIndex, recordingTimings, outputW, outputH, effectiveFontSize, fontFamily, fontLoaded, effectiveFontColor, effectiveStrokeColor, strokeWidthVal, strokeBlurVal, textAlign, effectiveTextX, effectiveTextY, songTitle, showCreditMode, effectiveLyricsCredit, effectiveMusicCredit, effectiveArrangementCredit, effectiveMembersCredit, calcFadeOpacity, getDefaultTextX, getDefaultTextY, project?.creditInTime, project?.creditOutTime, project?.creditAnimDuration, project?.creditTitleFontSize, project?.creditLyricsFontSize, project?.creditMusicFontSize, project?.creditArrangementFontSize, project?.creditMembersFontSize, project?.creditRightTitleFontSize, project?.creditWipeStartMs, project?.detectedBpm, effectiveRightTitle, findActiveLineIndex]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, currentTime]);

  const canvasRafRef = useRef(0);
  const drawCanvasRef = useRef(drawCanvas);
  drawCanvasRef.current = drawCanvas;
  useEffect(() => {
    const checkLoop = () => {
      if (isPlayingRef.current) {
        drawCanvasRef.current();
      }
      canvasRafRef.current = requestAnimationFrame(checkLoop);
    };
    canvasRafRef.current = requestAnimationFrame(checkLoop);
    return () => cancelAnimationFrame(canvasRafRef.current);
  }, []);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    const container = previewContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scaleX = outputW / rect.width;
    const scaleY = outputH / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    setIsDraggingText(true);
    const curX = effectiveTextX ?? getDefaultTextX();
    const curY = effectiveTextY ?? getDefaultTextY();
    dragTextRef.current = {
      startMouseX: canvasX,
      startMouseY: canvasY,
      startTextX: curX,
      startTextY: curY,
    };
    setLocalTextX(curX);
    setLocalTextY(curY);
  }, [outputW, outputH, effectiveTextX, effectiveTextY, textAlign]);

  useEffect(() => {
    if (!isDraggingText) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = previewContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scaleX = outputW / rect.width;
      const scaleY = outputH / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      const dx = canvasX - dragTextRef.current.startMouseX;
      const dy = canvasY - dragTextRef.current.startMouseY;
      const newX = Math.max(0, Math.min(outputW, dragTextRef.current.startTextX + dx));
      const newY = Math.max(0, Math.min(outputH, dragTextRef.current.startTextY + dy));
      latestDragPos.current = { x: newX, y: newY };
      setLocalTextX(newX);
      setLocalTextY(newY);
    };
    const handleMouseUp = () => {
      setIsDraggingText(false);
      const pos = latestDragPos.current;
      if (pos) {
        updateProjectData({ textX: pos.x, textY: pos.y });
      }
      latestDragPos.current = null;
      setLocalTextX(null);
      setLocalTextY(null);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingText, outputW, outputH]);


  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDividerRef.current = true;
    dividerStartXRef.current = e.clientX;
    dividerStartWidthRef.current = rightPanelWidth;
    const handleMove = (me: MouseEvent) => {
      if (!isDraggingDividerRef.current) return;
      const dx = dividerStartXRef.current - me.clientX;
      const newW = Math.max(320, Math.min(900, dividerStartWidthRef.current + dx));
      setRightPanelWidth(newW);
    };
    const handleUp = () => {
      isDraggingDividerRef.current = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [rightPanelWidth]);

  const handleTimingsUpdated = useCallback((timings: { id: string; startTime: number | null; endTime: number | null }[]) => {
    updateTimings(timings);
  }, [updateTimings]);

  const debouncedColorSave = useCallback((field: string, value: string) => {
    if (colorDebounceRef.current) clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => {
      updateProjectData({ [field]: value });
      if (field === "fontColor") setLocalFontColor(null);
      if (field === "strokeColor") setLocalStrokeColor(null);
      if (field === "motifColor") setLocalMotifColor(null);
    }, 300);
  }, []);

  const [telopExporting, setTelopExporting] = useState(false);

  const exportTelopFile = useCallback(async () => {
    if (!id || !project) return;
    setTelopExporting(true);
    try {
      const lines = lyrics || [];
      let audioBase64: string | null = null;
      let audioMimeType = "audio/mpeg";
      const activeTrackId = project.activeAudioTrackId;
      if (activeTrackId) {
        const track = await storage.getAudioTrack(activeTrackId);
        if (track) {
          const blob = new Blob([track.arrayBuffer], { type: track.mimeType || "audio/mpeg" });
          audioMimeType = track.mimeType || "audio/mpeg";
          const reader = new FileReader();
          audioBase64 = await new Promise<string>((resolve) => {
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.readAsDataURL(blob);
          });
        }
      }
      if (!audioBase64) {
        const audioData = await storage.getAudio(id);
        if (audioData) {
          const blob = new Blob([audioData.arrayBuffer], { type: audioData.mimeType || "audio/mpeg" });
          audioMimeType = audioData.mimeType || "audio/mpeg";
          const reader = new FileReader();
          audioBase64 = await new Promise<string>((resolve) => {
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1]);
            };
            reader.readAsDataURL(blob);
          });
        }
      }

      const telopData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
          name: project.name,
          fontSize: project.fontSize,
          fontFamily: project.fontFamily,
          fontColor: project.fontColor,
          strokeColor: project.strokeColor,
          strokeWidth: project.strokeWidth,
          strokeBlur: project.strokeBlur,
          textAlign: project.textAlign,
          textX: project.textX,
          textY: project.textY,
          outputWidth: project.outputWidth,
          outputHeight: project.outputHeight,
          songTitle: project.songTitle,
          lyricsCredit: project.lyricsCredit,
          musicCredit: project.musicCredit,
          arrangementCredit: project.arrangementCredit,
          motifColor: project.motifColor,
          audioDuration: project.audioDuration,
          audioTrimStart: project.audioTrimStart,
          detectedBpm: project.detectedBpm,
          bpmGridOffset: project.bpmGridOffset,
          creditInTime: project.creditInTime,
          creditOutTime: project.creditOutTime,
          creditAnimDuration: project.creditAnimDuration,
          creditTitleFontSize: project.creditTitleFontSize,
          creditLyricsFontSize: project.creditLyricsFontSize,
          creditMusicFontSize: project.creditMusicFontSize,
          creditArrangementFontSize: project.creditArrangementFontSize,
          creditMembersFontSize: project.creditMembersFontSize,
          creditRightTitleFontSize: project.creditRightTitleFontSize,
          creditHoldStartMs: project.creditHoldStartMs,
          creditWipeStartMs: project.creditWipeStartMs,
          creditRightTitle: project.creditRightTitle,
          creditRightTitleAnimDuration: project.creditRightTitleAnimDuration,
          creditTitleLayout: project.creditTitleLayout ?? 1,
        },
        lyrics: lines.map((l) => ({
          lineIndex: l.lineIndex,
          text: l.text,
          startTime: l.startTime,
          endTime: l.endTime,
          fadeIn: l.fadeIn ?? 0,
          fadeOut: l.fadeOut ?? 0,
          fontSize: l.fontSize ?? null,
          blankBefore: !!l.blankBefore,
        })),
        audio: audioBase64,
        markers: checkMarkers.map(m => ({ id: m.id, time: m.time })),
      };

      const json = JSON.stringify(telopData);
      const telopFileName = `${project.name || "project"}.telop`;

      const encoder = new TextEncoder();
      const uint8 = encoder.encode(json);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64Content = btoa(binary);
      const uploadRes = await fetch("/api/dropbox/upload-telop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: telopFileName,
          content: base64Content,
          preset: project.preset || "other",
        }),
      });
      if (uploadRes.ok) {
        const dropboxData = await uploadRes.json().catch(() => null);
        const savedPath = dropboxData?.dropboxPath || "";
        toast({ title: "✅ TEAM DROPBOX に保存されました", description: savedPath ? `${savedPath}` : telopFileName });
      } else {
        const errBody = await uploadRes.text().catch(() => "");
        toast({ title: "❌ Dropboxへの保存に失敗しました", description: errBody || "接続を確認してください", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "❌ エクスポートに失敗しました", description: err?.message || "", variant: "destructive" });
    } finally {
      setTelopExporting(false);
    }
  }, [id, project, lyrics, checkMarkers, toast]);

  const importTelopToCurrentProject = useCallback(async (file: File) => {
    if (!id) return;
    try {
      const text = await file.text();
      const telopData = JSON.parse(text);
      if (!telopData || !telopData.project || !telopData.lyrics) {
        toast({ title: "無効な .telop ファイルです", variant: "destructive" });
        return;
      }

      const updates: Partial<Project> = {};
      const src = telopData.project;
      if (src.fontSize != null) updates.fontSize = src.fontSize;
      if (src.fontFamily != null) updates.fontFamily = src.fontFamily;
      if (src.fontColor != null) updates.fontColor = src.fontColor;
      if (src.strokeColor != null) updates.strokeColor = src.strokeColor;
      if (src.strokeWidth != null) updates.strokeWidth = src.strokeWidth;
      if (src.strokeBlur != null) updates.strokeBlur = src.strokeBlur;
      if (src.textAlign != null) updates.textAlign = src.textAlign;
      if (src.textX != null) updates.textX = src.textX;
      if (src.textY != null) updates.textY = src.textY;
      if (src.outputWidth != null) updates.outputWidth = src.outputWidth;
      if (src.outputHeight != null) updates.outputHeight = src.outputHeight;
      if (src.songTitle != null) updates.songTitle = src.songTitle;
      if (src.lyricsCredit != null) updates.lyricsCredit = src.lyricsCredit;
      if (src.musicCredit != null) updates.musicCredit = src.musicCredit;
      if (src.arrangementCredit != null) updates.arrangementCredit = src.arrangementCredit;
      if (src.motifColor != null) updates.motifColor = src.motifColor;
      if (src.detectedBpm != null) updates.detectedBpm = src.detectedBpm;
      if (src.bpmGridOffset != null) updates.bpmGridOffset = src.bpmGridOffset;
      if (src.creditInTime != null) updates.creditInTime = src.creditInTime;
      if (src.creditOutTime != null) updates.creditOutTime = src.creditOutTime;
      if (src.creditAnimDuration != null) updates.creditAnimDuration = src.creditAnimDuration;
      if (src.creditTitleFontSize != null) updates.creditTitleFontSize = src.creditTitleFontSize;
      if (src.creditLyricsFontSize != null) updates.creditLyricsFontSize = src.creditLyricsFontSize;
      if (src.creditMusicFontSize != null) updates.creditMusicFontSize = src.creditMusicFontSize;
      if (src.creditArrangementFontSize != null) updates.creditArrangementFontSize = src.creditArrangementFontSize;
      if (src.creditMembersFontSize != null) updates.creditMembersFontSize = src.creditMembersFontSize;
      if (src.creditRightTitleFontSize != null) updates.creditRightTitleFontSize = src.creditRightTitleFontSize;
      if (src.creditHoldStartMs != null) updates.creditHoldStartMs = src.creditHoldStartMs;
      if (src.creditWipeStartMs != null) updates.creditWipeStartMs = src.creditWipeStartMs;
      if (src.creditRightTitle != null) updates.creditRightTitle = src.creditRightTitle;
      if (src.creditTitleLayout != null) updates.creditTitleLayout = src.creditTitleLayout;
      if (src.preset != null) updates.preset = src.preset;

      await storage.updateProject(id, updates);

      if (telopData.audio) {
        const binaryStr = atob(telopData.audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: telopData.audioMimeType || "audio/mpeg" });
        const importedAudioName = (src.audioFileName || src.songTitle || "imported_audio").replace(/\.[^.]+$/i, "") + ".mp3";
        const trackLabel = importedAudioName.replace(/\.mp3$/i, "");
        const track = await storage.saveAudioTrack(id, blob, importedAudioName, trackLabel, telopData.audioMimeType || "audio/mpeg");
        await storage.updateProject(id, { audioFileName: importedAudioName, activeAudioTrackId: track.id });

        const importPreset = src.preset || project?.preset || "other";
        const telopFormData = new FormData();
        telopFormData.append("audio", blob, importedAudioName);
        telopFormData.append("preset", importPreset);
        telopFormData.append("fileName", importedAudioName);
        telopFormData.append("mode", "auto");
        fetch("/api/dropbox/upload", { method: "POST", body: telopFormData })
          .then(async (dbxRes) => {
            if (dbxRes.ok) {
              const dbxData = await dbxRes.json();
              console.log("[TelopImport] Uploaded to Telop音源:", dbxData.dropboxPath);
              await storage.updateAudioTrackDropboxPath(track.id, dbxData.dropboxPath);
              const updatedTracks = await storage.getAudioTracks(id);
              setAudioTracks(updatedTracks);
            } else {
              console.warn("[TelopImport] Dropbox upload failed:", dbxRes.status);
            }
          })
          .catch((err) => {
            console.warn("[TelopImport] Dropbox upload error:", err);
          });
      }

      if (telopData.lyrics && telopData.lyrics.length > 0) {
        const sortedLyrics = [...telopData.lyrics].sort(
          (a: any, b: any) => (a.lineIndex ?? 0) - (b.lineIndex ?? 0)
        );
        const linesForInsert = sortedLyrics.map((l: any, i: number) => ({
          text: String(l.text || ""),
          lineIndex: i,
          blankBefore: !!(l.blankBefore || l.blank_before),
        }));
        const savedLines = await storage.setLyricLines(id, linesForInsert);

        const timingUpdates: { id: string; startTime: number | null; endTime: number | null }[] = [];
        for (let i = 0; i < sortedLyrics.length; i++) {
          const srcLine = sortedLyrics[i];
          if (srcLine.startTime != null || srcLine.endTime != null) {
            const saved = savedLines[i];
            if (saved) {
              timingUpdates.push({
                id: saved.id,
                startTime: typeof srcLine.startTime === "number" ? srcLine.startTime : null,
                endTime: typeof srcLine.endTime === "number" ? srcLine.endTime : null,
              });
            }
          }
        }
        if (timingUpdates.length > 0) {
          await storage.updateLyricTimings(timingUpdates);
        }
        const fadeUpdates: { id: string; fadeIn: number; fadeOut: number }[] = [];
        const fontSizeUpdates: { id: string; fontSize: number | null }[] = [];
        for (let i = 0; i < sortedLyrics.length; i++) {
          const srcLine = sortedLyrics[i];
          const saved = savedLines[i];
          if (saved) {
            if (srcLine.fadeIn || srcLine.fadeOut) {
              fadeUpdates.push({ id: saved.id, fadeIn: srcLine.fadeIn ?? 0, fadeOut: srcLine.fadeOut ?? 0 });
            }
            if (srcLine.fontSize != null) {
              fontSizeUpdates.push({ id: saved.id, fontSize: srcLine.fontSize });
            }
          }
        }
        if (fadeUpdates.length > 0) {
          await storage.updateLyricFades(fadeUpdates);
        }
        if (fontSizeUpdates.length > 0) {
          await storage.updateLyricFontSizes(fontSizeUpdates);
        }
      }

      if (telopData.markers && Array.isArray(telopData.markers)) {
        const importedMarkers = telopData.markers.map((m: any) => ({
          id: m.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: m.time,
        }));
        await storage.setCheckMarkers(id, importedMarkers);
        setCheckMarkers(importedMarkers);
      }

      const updated = await storage.getProject(id);
      if (updated) setProject(updated);
      await loadLyrics();

      toast({ title: `.telopファイルを読み込みました` });
    } catch {
      toast({ title: ".telopファイルの読み込みに失敗しました", variant: "destructive" });
    }
  }, [id, toast]);

  const changeFontSize = useCallback((delta: number) => {
    const newSize = Math.max(16, Math.min(200, (localFontSize ?? fontSize) + delta));
    setLocalFontSize(newSize);
    if (fontSizeDebounceRef.current) clearTimeout(fontSizeDebounceRef.current);
    fontSizeDebounceRef.current = setTimeout(() => {
      updateProjectData({ fontSize: newSize });
      setLocalFontSize(null);
    }, 300);
  }, [localFontSize, fontSize]);

  const selectedLineFontSize = useMemo(() => {
    if (timelineSelectedIds.size === 0 || !lyrics) return null;
    const selectedLines = lyrics.filter(l => timelineSelectedIds.has(l.id));
    if (selectedLines.length === 0) return null;
    const sizes = selectedLines.map(l => l.fontSize ?? fontSize);
    const allSame = sizes.every(s => s === sizes[0]);
    return { size: allSame ? sizes[0] : null, count: selectedLines.length, mixed: !allSame };
  }, [timelineSelectedIds, lyrics, fontSize]);

  const changeLineFontSize = useCallback(async (delta: number) => {
    if (timelineSelectedIds.size === 0 || !lyrics) return;
    const selectedLines = lyrics.filter(l => timelineSelectedIds.has(l.id));
    if (selectedLines.length === 0) return;
    const oldValues = selectedLines.map(l => ({ id: l.id, fontSize: l.fontSize ?? null }));
    const updates = selectedLines.map(l => {
      const current = l.fontSize ?? fontSize;
      return { id: l.id, fontSize: Math.max(16, Math.min(200, current + delta)) };
    });
    await storage.updateLyricFontSizes(updates);
    setLyrics(prev => prev?.map(l => {
      const u = updates.find(v => v.id === l.id);
      return u ? { ...l, fontSize: u.fontSize } : l;
    }));
    pushUndo({
      description: "個別文字サイズ変更",
      undo: async () => {
        await storage.updateLyricFontSizes(oldValues);
        setLyrics(prev => prev?.map(l => { const o = oldValues.find(v => v.id === l.id); return o ? { ...l, fontSize: o.fontSize } : l; }));
        if (id) syncService.schedulePush(id);
      },
      redo: async () => {
        await storage.updateLyricFontSizes(updates);
        setLyrics(prev => prev?.map(l => { const u = updates.find(v => v.id === l.id); return u ? { ...l, fontSize: u.fontSize } : l; }));
        if (id) syncService.schedulePush(id);
      },
    });
    if (id) syncService.schedulePush(id);
  }, [timelineSelectedIds, lyrics, fontSize, id, pushUndo]);

  const resetLineFontSize = useCallback(async () => {
    if (timelineSelectedIds.size === 0 || !lyrics) return;
    const selectedLines = lyrics.filter(l => timelineSelectedIds.has(l.id) && l.fontSize !== null);
    if (selectedLines.length === 0) return;
    const oldValues = selectedLines.map(l => ({ id: l.id, fontSize: l.fontSize }));
    const updates = selectedLines.map(l => ({ id: l.id, fontSize: null as number | null }));
    await storage.updateLyricFontSizes(updates);
    setLyrics(prev => prev?.map(l => {
      const u = updates.find(v => v.id === l.id);
      return u ? { ...l, fontSize: null } : l;
    }));
    pushUndo({
      description: "個別文字サイズリセット",
      undo: async () => {
        await storage.updateLyricFontSizes(oldValues);
        setLyrics(prev => prev?.map(l => { const o = oldValues.find(v => v.id === l.id); return o ? { ...l, fontSize: o.fontSize } : l; }));
        if (id) syncService.schedulePush(id);
      },
      redo: async () => {
        await storage.updateLyricFontSizes(updates);
        setLyrics(prev => prev?.map(l => { const u = updates.find(v => v.id === l.id); return u ? { ...l, fontSize: null } : l; }));
        if (id) syncService.schedulePush(id);
      },
    });
    if (id) syncService.schedulePush(id);
  }, [timelineSelectedIds, lyrics, id, pushUndo]);

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">読み込み中...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">プロジェクトが見つかりません</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          ホームに戻る
        </Button>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen max-w-full flex flex-col overflow-hidden gap-[3px] relative"
      style={{ padding: "6px 6px 8px 6px", backgroundColor: "hsl(0 0% 4%)" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          const f = files[0];
          const fext = f.name.split(".").pop()?.toLowerCase() || "";
          if (fext === "telop") {
            importTelopToCurrentProject(f);
          } else {
            const aExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "opus", "webm", "mp4"];
            if (f.type.startsWith("audio/") || aExts.includes(fext)) {
              handleAudioDrop(f);
            }
          }
        }
      }}
    >
      <audio ref={audioRefCallback} src={audioUrl || undefined} preload="auto"
        onLoadedMetadata={ensureVolume}
        onLoadedData={ensureVolume}
        onCanPlay={ensureVolume}
        onPlay={ensureVolume}
      />

      {(uploadingLyrics || (uploadingAudio && audioCompressProgress !== null)) && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
          style={{ backgroundColor: "hsla(0, 0%, 4%, 0.92)", backdropFilter: "blur(4px)" }}
          data-testid="processing-overlay"
        >
          <div className="flex flex-col items-center gap-4 p-8 rounded-xl" style={{ backgroundColor: "hsl(0 0% 9%)", border: "1px solid hsl(0 0% 18%)", minWidth: "320px" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "hsla(0, 0%, 50%, 0.15)", border: "1px solid hsla(0, 0%, 50%, 0.3)" }}>
              {uploadingLyrics
                ? <FileText className="w-5 h-5 animate-pulse" style={{ color: "hsl(0 0% 65%)" }} />
                : <Music className="w-5 h-5 animate-pulse" style={{ color: "hsl(0 0% 65%)" }} />
              }
            </div>
            <div className="text-center">
              <div className="text-sm font-bold mb-1" style={{ color: "hsl(0 0% 90%)" }}>
                {uploadingLyrics
                  ? "歌詞ファイルを読み込み中..."
                  : (audioProcessPhase || "音声を処理中...")
                }
              </div>
              {uploadingAudio && audioCompressProgress !== null && (
                <div className="text-xs font-mono" style={{ color: "hsl(0 0% 65%)" }}>
                  {audioCompressProgress}%
                </div>
              )}
            </div>
            {uploadingAudio && audioCompressProgress !== null ? (
              <>
                <div className="w-64 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "hsl(0 0% 15%)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${audioCompressProgress}%`,
                      background: "linear-gradient(90deg, hsl(0 0% 45%), hsl(0 0% 55%))",
                    }}
                  />
                </div>
                <div className="text-[10px] font-mono" style={{ color: "hsl(0 0% 40%)" }}>
                  {audioCompressProgress < 5
                    ? "STEP 1/3 : READ & DECODE"
                    : audioCompressProgress < 99
                    ? "STEP 2/3 : MP3 ENCODE"
                    : "STEP 3/3 : SAVE"}
                </div>
              </>
            ) : uploadingLyrics ? (
              <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "hsl(0 0% 15%)" }}>
                <div
                  className="h-full rounded-full animate-pulse"
                  style={{
                    width: "60%",
                    background: "linear-gradient(90deg, hsl(0 0% 45%), hsl(0 0% 55%))",
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={saveAsOpen} onOpenChange={(open) => { if (!open) { setSaveAsOpen(false); setSaveAsName(""); } }}>
        <DialogContent className="sm:max-w-[420px]" style={{ backgroundColor: "hsl(0 0% 10%)", border: "1px solid hsl(48 100% 45% / 0.25)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(48 100% 50%)" }}>別名で保存</DialogTitle>
            <DialogDescription style={{ color: "hsl(0 0% 55%)" }}>
              現在のプロジェクトをコピーして新しいプロジェクトとして保存します
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="新しいプロジェクト名"
              autoFocus
              data-testid="input-save-as-name"
              className="text-sm"
              style={{ backgroundColor: "hsl(0 0% 14%)", border: "1px solid hsl(48 100% 45% / 0.3)", color: "hsl(0 0% 90%)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveAsName.trim() && !saveAsProcessing) {
                  handleSaveAs();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => { setSaveAsOpen(false); setSaveAsName(""); }} style={{ color: "hsl(0 0% 60%)" }}>
              キャンセル
            </Button>
            <Button
              onClick={handleSaveAs}
              disabled={!saveAsName.trim() || saveAsProcessing}
              data-testid="button-save-as-confirm"
              style={{ backgroundColor: "hsl(48 100% 45%)", color: "hsl(0 0% 5%)" }}
            >
              {saveAsProcessing ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={audioConfirmStep === "enter_name"} onOpenChange={(open) => { if (!open) cancelAudioImport(); }}>
        <DialogContent className="sm:max-w-[420px]" style={{ backgroundColor: "hsl(0 0% 10%)", border: "1px solid hsl(48 100% 45% / 0.25)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(48 100% 50%)" }}>音源名を入力</DialogTitle>
            <DialogDescription style={{ color: "hsl(0 0% 55%)" }}>
              音源の名前を入力してください
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={pendingTrackLabel}
              onChange={(e) => setPendingTrackLabel(e.target.value)}
              placeholder="トラック名"
              autoFocus
              data-testid="input-track-label"
              className="text-sm"
              style={{ backgroundColor: "hsl(0 0% 14%)", border: "1px solid hsl(48 100% 45% / 0.3)", color: "hsl(0 0% 90%)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingTrackLabel.trim()) {
                  executeAudioImport();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={cancelAudioImport} data-testid="button-trackname-cancel" style={{ color: "hsl(0 0% 60%)" }}>
              キャンセル
            </Button>
            <Button
              onClick={executeAudioImport}
              disabled={!pendingTrackLabel.trim()}
              data-testid="button-trackname-confirm"
              style={{ backgroundColor: "hsl(48 100% 45%)", color: "hsl(0 0% 5%)" }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.xlsx,.xls,.pdf,.txt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadLyricsFile(file);
          e.target.value = "";
        }}
        data-testid="input-lyrics-file"
      />
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadAudioFile(file);
          e.target.value = "";
        }}
        data-testid="input-audio-file"
      />

      <header className="flex items-center justify-between gap-4 px-3 py-1.5 shrink-0" style={{ backgroundColor: "hsl(0 0% 9%)", border: "1px solid hsl(0 0% 22%)" }}>
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden" style={{ flex: "1 1 50%", maxWidth: "50%" }}>
          <Button tabIndex={-1} size="icon" variant="ghost" onClick={() => navigate("/")} data-testid="button-back" className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="w-px h-5 shrink-0" style={{ backgroundColor: "hsl(0 0% 18%)" }} />
          <span className="shrink-0 text-center flex flex-col items-center justify-center" style={{ color: "hsl(48 100% 50%)", lineHeight: "1.15" }}>
            <span className="font-mono font-black" style={{ fontSize: "10px", letterSpacing: "0.28em" }}>SONG</span>
            <span className="font-mono font-bold" style={{ fontSize: "10px", letterSpacing: "0.05em" }}>TITLE</span>
          </span>
          <div className="shrink-0" style={{ width: "6px" }} />
          <input
            className="font-bold text-2xl bg-transparent border-none outline-none min-w-0 w-full"
            style={{ color: "hsl(0 0% 95%)", letterSpacing: "0.02em", fontFamily: `"${fontFamily}", "Noto Sans JP", sans-serif` }}
            value={localProjectName !== null ? localProjectName : (project.name || "")}
            onChange={(e) => { setLocalProjectName(e.target.value); debouncedCreditSave("name", e.target.value); }}
            onBlur={() => { flushCreditSave("name").then(() => { setLocalProjectName(null); storage.getProject(id!).then(p => p && setProject(p)); }); }}
            data-testid="input-project-name"
            placeholder="PROJECT NAME"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {project.audioFileName && (() => {
            const activeTrack = audioTracks.find(t => t.id === project.activeAudioTrackId);
            const displayName = project.audioFileName.replace(/\.mp3$/i, "");
            return (
              <div className="flex items-center gap-1 rounded-md px-1.5 py-0.5" style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 22%)" }}>
                <Music className="w-3 h-3 shrink-0" style={{ color: "hsl(0 0% 45%)" }} />
                {editingAudioName ? (
                  <input
                    autoFocus
                    className="text-[11px] bg-transparent border-none outline-none min-w-[80px] max-w-[200px]"
                    style={{ color: "hsl(0 0% 90%)" }}
                    defaultValue={displayName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) handleRenameAudioFile(val);
                        setEditingAudioName(false);
                      }
                      if (e.key === "Escape") setEditingAudioName(false);
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && val !== displayName) handleRenameAudioFile(val);
                      setEditingAudioName(false);
                    }}
                    data-testid="input-audio-rename"
                  />
                ) : (
                  <span
                    className="text-[11px] cursor-pointer truncate max-w-[180px]"
                    style={{ color: "hsl(0 0% 70%)" }}
                    onClick={() => setEditingAudioName(true)}
                    title={`${project.audioFileName}${activeTrack?.dropboxPath ? `\nDropbox: ${activeTrack.dropboxPath}` : ""}\nクリックでリネーム`}
                    data-testid="text-audio-filename"
                  >
                    {displayName}
                  </span>
                )}
                <button
                  className="p-0 bg-transparent border-none cursor-pointer shrink-0"
                  onClick={() => setEditingAudioName(!editingAudioName)}
                  style={{ color: "hsl(0 0% 40%)" }}
                  data-testid="button-audio-rename"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })()}
          <div className="flex items-center gap-1 rounded-md px-1 py-0.5" style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 22%)" }}>
            <span className="text-[9px] font-bold tracking-wider uppercase px-1" style={{ color: "hsl(0 0% 40%)" }}>IN</span>
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-xs h-6 px-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLyrics}
              data-testid="button-import-file"
            >
              <Upload className="w-3 h-3 mr-1" />
              {uploadingLyrics ? "..." : "Lyric"}
            </Button>
            <div className="w-px h-3.5" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-xs h-6 px-2"
              onClick={() => audioFileInputRef.current?.click()}
              disabled={uploadingAudio}
              data-testid="button-upload-audio"
            >
              <Music className="w-3 h-3 mr-1" />
              {uploadingAudio ? "..." : "Audio"}
            </Button>
            <div className="w-px h-3.5" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-[9px] h-6 px-1.5 tracking-wide"
              style={{ color: "hsl(210 90% 60%)" }}
              onClick={() => setDropboxPickerOpen(true)}
              disabled={uploadingAudio}
              title="チーム共有Dropboxから選択"
              data-testid="button-dropbox-audio"
            >
              <Cloud className="w-3 h-3 mr-0.5" />
              TEAM
            </Button>
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-[9px] h-6 px-1.5 tracking-wide"
              style={{ color: "hsl(210 90% 60%)" }}
              onClick={openPersonalDropboxChooser}
              disabled={uploadingAudio}
              title="個人Dropboxから選択"
              data-testid="button-personal-dropbox"
            >
              <Cloud className="w-3 h-3 mr-0.5" />
              MDB
            </Button>
          </div>

          <div className="flex items-center gap-1 rounded-md px-1 py-0.5" style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 22%)" }}>
            <span className="text-[10px] font-bold tracking-wider text-white/40 uppercase">OUT</span>
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={exportTelopFile}
              disabled={telopExporting}
              data-testid="button-telop-export"
              title="プロジェクトファイル保存（.telop）"
            >
              <Package className="w-3.5 h-3.5 mr-1.5" />
              {telopExporting ? "..." : ".telop"}
            </Button>
            <div className="w-px h-3.5" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
            <Button
              tabIndex={-1}
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2 text-white"
              onClick={() => setExportOpen(true)}
              disabled={!lyrics || lyrics.length === 0}
              data-testid="button-export"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              EXPORT
            </Button>
          </div>

          <Button
            tabIndex={-1}
            size="icon"
            variant="ghost"
            className="w-7 h-7 shrink-0"
            onClick={() => setDropboxOAuthDialogOpen(true)}
            title={dropboxOAuthStatus?.customConnected ? "Dropbox接続中" : "Dropboxに接続"}
            data-testid="button-dropbox-oauth"
          >
            {dropboxOAuthStatus?.customConnected
              ? <Link2 className="w-3.5 h-3.5" style={{ color: "hsl(210 80% 60%)" }} />
              : <Unlink2 className="w-3.5 h-3.5" style={{ color: "hsl(0 50% 55%)" }} />
            }
          </Button>
        </div>
        </header>

        <Dialog open={dropboxOAuthDialogOpen} onOpenChange={setDropboxOAuthDialogOpen}>
          <DialogContent style={{ backgroundColor: "hsl(0 0% 11%)", border: "1px solid hsl(0 0% 22%)" }}>
            <DialogHeader>
              <DialogTitle style={{ color: "hsl(0 0% 90%)" }}>Dropbox 接続設定</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {dropboxOAuthStatus?.customConfigured ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(0 0% 70%)" }}>
                    {dropboxOAuthStatus.customConnected
                      ? <><Link2 className="w-4 h-4" style={{ color: "hsl(210 80% 60%)" }} /><span>チームDropboxに接続済み</span></>
                      : <><Unlink2 className="w-4 h-4" style={{ color: "hsl(0 50% 55%)" }} /><span>未接続（接続してください）</span></>
                    }
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleDropboxOAuthConnect}
                    disabled={dropboxOAuthConnecting}
                    data-testid="button-dropbox-connect"
                    style={{ backgroundColor: "hsl(210 70% 45%)", color: "white" }}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    {dropboxOAuthConnecting ? "接続中..." : dropboxOAuthStatus.customConnected ? "Dropboxを再接続" : "Dropboxに接続"}
                  </Button>
                  <p className="text-[10px] text-center" style={{ color: "hsl(0 0% 40%)" }}>
                    ポップアップが開きます。Dropboxでログインして「Allow」を押してください。
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm" style={{ color: "hsl(0 60% 60%)" }}>DROPBOX_APP_KEY が設定されていません。</p>
                  <p className="text-xs" style={{ color: "hsl(0 0% 50%)" }}>サーバーの環境変数に DROPBOX_APP_KEY と DROPBOX_APP_SECRET を設定してください。</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>


      <div className="flex-1 flex flex-col overflow-hidden gap-[3px]" style={{ minHeight: 0 }}>
        <div className="flex-1 flex overflow-hidden gap-[3px]" style={{ minHeight: 0 }}>
          <div className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ border: "1px solid hsl(0 0% 22%)", overflow: "hidden", minHeight: 0 }}>
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-x-2.5 gap-y-1 flex-wrap" style={{ backgroundColor: "hsl(0 0% 9%)", borderBottom: "1px solid hsl(0 0% 22%)" }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 50%)" }}>Font</span>
              <Select
                value={fontFamily}
                onValueChange={(v) => updateProjectData({ fontFamily: v })}
              >
                <SelectTrigger className="h-7 text-xs w-32" data-testid="select-font-inline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: selectedLineFontSize ? "hsl(48 100% 45%)" : activeLineFontSizeHeader != null ? "hsl(48 100% 45%)" : "hsl(0 0% 40%)" }}>Size</span>
              <Button
                tabIndex={-1}
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => selectedLineFontSize ? changeLineFontSize(-4) : changeFontSize(-4)}
                data-testid="button-font-size-down"
              >
                <Minus className="w-3 h-3" />
              </Button>
              <span className="text-xs font-mono w-8 text-center" style={selectedLineFontSize ? { color: "hsl(48 100% 50%)" } : activeLineFontSizeHeader != null ? { color: "hsl(48 100% 50%)" } : undefined} data-testid="text-font-size">{selectedLineFontSize ? (selectedLineFontSize.mixed ? "—" : selectedLineFontSize.size) : activeLineFontSizeHeader != null ? activeLineFontSizeHeader : effectiveFontSize}</span>
              <Button
                tabIndex={-1}
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => selectedLineFontSize ? changeLineFontSize(4) : changeFontSize(4)}
                data-testid="button-font-size-up"
              >
                <Plus className="w-3 h-3" />
              </Button>
              {selectedLineFontSize && (
                <button
                  className="text-[8px] px-1 py-0.5 rounded hover:bg-white/10"
                  style={{ color: "hsl(0 0% 50%)", border: "1px solid hsl(0 0% 30%)" }}
                  onClick={resetLineFontSize}
                  title="個別サイズをリセット（全体設定に戻す）"
                  data-testid="button-line-font-size-reset"
                  tabIndex={-1}
                >RST</button>
              )}
            </div>

            <div className="flex items-center gap-0.5 border border-border/50 rounded-md">
              <Button
                tabIndex={-1}
                size="icon"
                variant={textAlign === "left" ? "secondary" : "ghost"}
                className="h-6 w-6 rounded-none rounded-l-md"
                onClick={() => updateProjectData({ textAlign: "left", textX: null })}
                data-testid="button-align-left"
              >
                <AlignLeft className="w-3 h-3" />
              </Button>
              <Button
                tabIndex={-1}
                size="icon"
                variant={textAlign === "center" ? "secondary" : "ghost"}
                className="h-6 w-6 rounded-none"
                onClick={() => updateProjectData({ textAlign: "center", textX: null })}
                data-testid="button-align-center"
              >
                <AlignCenter className="w-3 h-3" />
              </Button>
              <Button
                tabIndex={-1}
                size="icon"
                variant={textAlign === "right" ? "secondary" : "ghost"}
                className="h-6 w-6 rounded-none rounded-r-md"
                onClick={() => updateProjectData({ textAlign: "right", textX: null })}
                data-testid="button-align-right"
              >
                <AlignRight className="w-3 h-3" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 40%)" }}>Color</span>
              <ColorPicker
                value={effectiveFontColor}
                onChange={(c) => {
                  setLocalFontColor(c);
                  debouncedColorSave("fontColor", c);
                }}
                size={28}
                testId="picker-font-color"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 40%)" }}>Stroke</span>
              <ColorPicker
                value={effectiveStrokeColor}
                onChange={(c) => {
                  setLocalStrokeColor(c);
                  debouncedColorSave("strokeColor", c);
                  if (strokeWidthVal === 0) updateProjectData({ strokeWidth: 8 });
                }}
                onClear={() => updateProjectData({ strokeWidth: 0 })}
                disabled={strokeWidthVal === 0}
                size={28}
                testId="picker-stroke-color"
              />
            </div>
            <div className="flex items-center gap-0.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 40%)" }}>W</span>
              <button
                className="flex items-center justify-center rounded hover:bg-white/15 active:bg-white/25"
                style={{ width: 16, height: 18, color: "hsl(0 0% 55%)", fontSize: 11 }}
                onClick={() => updateProjectData({ strokeWidth: Math.max(0, strokeWidthVal - 1) })}
                tabIndex={-1}
                data-testid="btn-stroke-width-minus"
              >−</button>
              <span className="text-[10px] font-mono font-bold text-center" style={{ color: "hsl(0 0% 70%)", width: 16 }}>{strokeWidthVal}</span>
              <button
                className="flex items-center justify-center rounded hover:bg-white/15 active:bg-white/25"
                style={{ width: 16, height: 18, color: "hsl(0 0% 55%)", fontSize: 11 }}
                onClick={() => updateProjectData({ strokeWidth: Math.min(20, strokeWidthVal + 1) })}
                tabIndex={-1}
                data-testid="btn-stroke-width-plus"
              >+</button>
            </div>
            <div className="flex items-center gap-0.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 40%)" }}>Blur</span>
              <button
                className="flex items-center justify-center rounded hover:bg-white/15 active:bg-white/25"
                style={{ width: 16, height: 18, color: "hsl(0 0% 55%)", fontSize: 11 }}
                onClick={() => updateProjectData({ strokeBlur: Math.max(0, strokeBlurVal - 1) })}
                tabIndex={-1}
                data-testid="btn-stroke-blur-minus"
              >−</button>
              <span className="text-[10px] font-mono font-bold text-center" style={{ color: "hsl(0 0% 70%)", width: 16 }}>{strokeBlurVal}</span>
              <button
                className="flex items-center justify-center rounded hover:bg-white/15 active:bg-white/25"
                style={{ width: 16, height: 18, color: "hsl(0 0% 55%)", fontSize: 11 }}
                onClick={() => updateProjectData({ strokeBlur: Math.min(20, strokeBlurVal + 1) })}
                tabIndex={-1}
                data-testid="btn-stroke-blur-plus"
              >+</button>
            </div>
            <div className="w-px h-4" style={{ backgroundColor: "hsl(0 0% 18%)" }} />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider uppercase shrink-0" style={{ color: "hsl(0 0% 40%)" }}>Preset</span>
              <Select
                value={preset}
                onValueChange={(v) => {
                  const p = PRESETS[v] || PRESETS.other;
                  updateProjectData({
                    preset: v,
                    fontFamily: p.fontFamily,
                    fontSize: p.fontSize,
                    fontColor: p.fontColor,
                    strokeColor: p.strokeColor,
                    strokeWidth: p.strokeWidth,
                    strokeBlur: p.strokeBlur,
                    textAlign: p.textAlign,
                    textX: p.textX,
                    textY: p.textY,
                    creditLineY: p.demoLineY,
                    creditTitleFontSize: p.creditTitleFontSize,
                    creditLyricsFontSize: p.creditInfoFontSize,
                    creditMusicFontSize: p.creditInfoFontSize,
                    creditArrangementFontSize: p.creditInfoFontSize,
                    creditMembersFontSize: p.creditInfoFontSize,
                    creditRightTitleFontSize: p.creditRightTitleFontSize,
                  });
                  demoLineYRef.current = p.demoLineY;
                }}
              >
                <SelectTrigger className="h-7 text-xs w-28" data-testid="select-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sakurazaka">櫻坂46</SelectItem>
                  <SelectItem value="hinatazaka">日向坂46</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <button
                className="flex items-center justify-center rounded px-1.5 hover:bg-white/15 active:bg-white/25"
                style={{ height: 20, color: "hsl(40 80% 60%)", fontSize: 9, fontFamily: "monospace", border: "1px solid hsl(40 40% 30%)" }}
                onClick={() => {
                  updateProjectData({
                    fontSize: activePreset.fontSize,
                    fontColor: activePreset.fontColor,
                    strokeColor: activePreset.strokeColor,
                    strokeWidth: activePreset.strokeWidth,
                    strokeBlur: activePreset.strokeBlur,
                    textAlign: activePreset.textAlign,
                    textX: activePreset.textX,
                    textY: activePreset.textY,
                    creditLineY: activePreset.demoLineY,
                    creditTitleFontSize: activePreset.creditTitleFontSize,
                    creditLyricsFontSize: activePreset.creditInfoFontSize,
                    creditMusicFontSize: activePreset.creditInfoFontSize,
                    creditArrangementFontSize: activePreset.creditInfoFontSize,
                    creditMembersFontSize: activePreset.creditInfoFontSize,
                    creditRightTitleFontSize: activePreset.creditRightTitleFontSize,
                  });
                  setLocalFontColor(activePreset.fontColor);
                  setLocalStrokeColor(activePreset.strokeColor);
                  demoLineYRef.current = activePreset.demoLineY;
                }}
                title={`全設定をデフォルトに戻す (Size ${activePreset.fontSize}, W ${activePreset.strokeWidth}, Blur ${activePreset.strokeBlur})`}
                data-testid="btn-preset-default"
                tabIndex={-1}
              >Default</button>
            </div>
          </div>

          <div ref={previewWrapperRef} className="flex-1 flex items-center justify-center p-1 overflow-hidden relative group/preview" style={{ backgroundColor: "#000000", minHeight: 0 }} onMouseDown={() => { const el = document.activeElement as HTMLElement; if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.blur(); }}>
          <div
            ref={previewContainerRef}
            className={`bg-black relative overflow-hidden rounded ${isDraggingText ? "cursor-grabbing" : "cursor-grab"}`}
            style={previewSize ? { width: previewSize.width, height: previewSize.height } : { maxWidth: "100%", maxHeight: "100%", aspectRatio: `${outputW} / ${outputH}` }}
            onMouseDown={handlePreviewMouseDown}
            data-testid="preview-area"
          >
            <canvas
              ref={canvasRef}
              style={{
                width: "100%",
                height: "100%",
              }}
              data-testid="canvas-preview"
            />
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-30 pointer-events-none" data-testid="countdown-overlay">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-7xl font-bold text-white tabular-nums animate-pulse" data-testid="text-countdown">
                    {countdown}
                  </span>
                  <span className="text-sm text-white/60">録画開始まで...</span>
                </div>
              </div>
            )}
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1 px-2 py-1.5 z-10 opacity-0 group-hover/preview:opacity-100 transition-opacity duration-200"
            style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}
            data-testid="preview-footer"
          >
            <span className="text-[9px] font-mono mr-auto" style={{ color: "hsl(0 0% 45%)" }}>
              {outputW}×{outputH}
            </span>
            <button
              tabIndex={-1}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
              style={{
                color: previewBgMode === "color" ? "hsl(0 0% 65%)" : "hsl(0 0% 70%)",
              }}
              onClick={() => setPreviewBgMode(prev => prev === "checker" ? "color" : "checker")}
              data-testid="button-preview-bg"
              title={previewBgMode === "checker" ? "背景をテーマカラーに" : "背景をチェッカーに"}
            >
              <div
                className="w-3.5 h-3.5 rounded-sm border"
                style={{
                  backgroundColor: "hsl(0 0% 35%)",
                  borderColor: previewBgMode === "color" ? "hsl(0 0% 65%)" : "hsl(0 0% 50%)",
                }}
              />
            </button>
            <button
              tabIndex={-1}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
              style={{ color: "hsl(0 0% 70%)" }}
              onClick={() => setPreviewFullscreen(true)}
              data-testid="button-fullscreen-preview"
              title="フルスクリーン (1)"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>
          </div>
          </div>

          <div
            className="shrink-0 flex items-center justify-center cursor-col-resize select-none group"
            style={{ width: "8px" }}
            onMouseDown={handleDividerMouseDown}
            data-testid="panel-divider"
          >
            <div className="w-[3px] h-10 rounded-full group-hover:h-16 transition-all" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
          </div>

        <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: `${rightPanelWidth}px`, border: "1px solid hsl(0 0% 22%)", backgroundColor: "hsl(0 0% 8%)" }}>
          {isRecording ? (
            <div className="px-3 py-2 border-b border-border/40 shrink-0 bg-red-950/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="animate-pulse" data-testid="badge-recording">
                  <Circle className="w-2.5 h-2.5 mr-1 fill-current" />
                  REC
                </Badge>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {recordingIndex === -2 ? "STANDBY" : `${recordingIndex + 1}/${lyrics?.length || 0}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button tabIndex={-1} size="sm" variant="outline" className="text-xs" onClick={advanceLine} data-testid="button-advance">
                  <SkipForward className="w-3 h-3 mr-1" />
                  {recordingIndex === -2 ? "GO" : "NEXT"}
                </Button>
                <Button
                  tabIndex={-1}
                  size="sm"
                  className="text-xs font-bold"
                  style={{
                    backgroundColor: "hsl(0 50% 30%)",
                    border: "1px solid hsl(0 50% 40%)",
                    color: "#fff",
                  }}
                  onClick={finishRecording}
                  data-testid="button-stop-recording"
                >
                  <Square className="w-3 h-3 mr-1" fill="currentColor" />
                  STOP
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 shrink-0 flex items-center gap-2" style={{ borderBottom: "1px solid hsl(0 0% 22%)" }}>
              {!isRecording && countdown === null && (
                <Button
                  tabIndex={-1}
                  size="sm"
                  className="text-xs font-bold"
                  style={{
                    backgroundColor: "hsl(0 70% 40%)",
                    border: "1px solid hsl(0 70% 50%)",
                    color: "#fff",
                  }}
                  onClick={startRecording}
                  disabled={!audioUrl || !lyrics || lyrics.length === 0}
                  data-testid="button-start-recording-panel"
                >
                  <Circle className="w-3 h-3 mr-1 fill-current" />
                  REC
                </Button>
              )}
              <Button
                tabIndex={-1}
                size="sm"
                variant="ghost"
                className="text-[11px] px-2 py-1 opacity-60 hover:opacity-100 tracking-wider font-semibold"
                onClick={() => setShortcutsOpen(true)}
                data-testid="button-shortcuts"
                title="ショートカット一覧"
              >
                <Keyboard className="w-3.5 h-3.5 mr-1" />
                SHORT CUT
              </Button>
              <Button
                tabIndex={-1}
                size="icon"
                variant="ghost"
                className="h-6 w-6 ml-auto opacity-50 hover:opacity-100"
                onClick={() => setMinimalMode(!minimalMode)}
                data-testid="button-minimal-mode"
                title={minimalMode ? "通常表示に戻す" : "最小限表示"}
              >
                {minimalMode ? <Maximize className="w-3.5 h-3.5" /> : <Minimize className="w-3.5 h-3.5" />}
              </Button>
            </div>
          )}

          {isRecording && (
            <div className="px-3 py-1 border-b border-border/30 shrink-0 bg-red-950/10">
              <span className="text-[10px] text-muted-foreground font-mono">
                {recordingIndex === -2 ? "Space : 1行目を開始 (黒画面で待機中)" : "Space / Enter / → : Next ｜ Esc : Stop"}
              </span>
            </div>
          )}

          {!isRecording && minimalMode && (
            <div className="shrink-0 px-3 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid hsl(0 0% 22%)" }}>
              <Button tabIndex={-1} size="sm" variant="outline" className="h-7 text-xs" onClick={() => { if (audioRef.current) { if (isPlaying) audioRef.current.pause(); else safePlay().catch(() => {}); } }} disabled={!audioUrl} data-testid="button-minimal-play">
                {isPlaying ? <Pause className="w-3 h-3 mr-1" /> : <Music className="w-3 h-3 mr-1" />}
                {isPlaying ? "PAUSE" : "PLAY"}
              </Button>
              <span className="text-[10px] font-mono" style={{ color: "hsl(0 0% 50%)" }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                className="ml-auto text-[8px] px-1.5 py-0.5 rounded font-bold"
                style={{
                  backgroundColor: showCreditMode ? "hsl(0 0% 22%)" : "hsl(0 0% 15%)",
                  color: showCreditMode ? "hsl(0 0% 85%)" : "hsl(0 0% 45%)",
                  border: `1px solid ${showCreditMode ? "hsl(0 0% 32%)" : "hsl(0 0% 20%)"}`,
                }}
                onClick={() => setShowCreditMode(!showCreditMode)}
                data-testid="button-minimal-credit-toggle"
              >
                CREDIT {showCreditMode ? "ON" : "OFF"}
              </button>
            </div>
          )}

          {!isRecording && !minimalMode && (() => {
            const creditInfoSize = project?.creditLyricsFontSize ?? 36;
            return (
              <div className="mx-2 mt-2 mb-2 shrink-0 relative overflow-hidden" style={{ border: "1px solid hsl(0 0% 20%)", backgroundColor: "hsl(0 0% 8%)" }} data-testid="credit-block">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 cursor-grab active:cursor-grabbing select-none"
                  style={{ borderBottom: "1px solid hsl(0 0% 20%)", background: "hsl(0 0% 11%)", minHeight: 28 }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) return;
                    e.preventDefault();
                    startCreditDrag();
                  }}
                  data-testid="credit-drag-header"
                >
                  <GripVertical style={{ width: 12, height: 12, color: "hsl(0 0% 50%)" }} />
                  <Music style={{ width: 14, height: 14, color: "hsl(48 100% 50%)" }} />
                  <span className="text-[12px] font-bold tracking-widest uppercase" style={{ color: "hsl(48 100% 50%)" }}>CREDIT</span>
                  {[1, 2].map(layoutNum => {
                    const isActive = project.creditInTime != null && (project.creditTitleLayout ?? 1) === layoutNum;
                    const isOtherActive = project.creditInTime != null && (project.creditTitleLayout ?? 1) !== layoutNum;
                    return (
                      <button
                        key={layoutNum}
                        className={`${layoutNum === 1 ? "ml-auto" : "ml-1"} text-[8px] px-1.5 py-0.5 rounded font-bold`}
                        style={{
                          backgroundColor: duration <= 0 ? "hsl(0 0% 15%)" : isActive ? "hsl(48 60% 22%)" : "hsl(48 30% 14%)",
                          color: duration <= 0 ? "hsl(0 0% 35%)" : isActive ? "hsl(48 100% 65%)" : "hsl(48 80% 50%)",
                          border: `1px solid ${duration <= 0 ? "hsl(0 0% 20%)" : isActive ? "hsl(48 80% 40%)" : "hsl(48 50% 28%)"}`,
                          cursor: duration <= 0 ? "not-allowed" : "pointer",
                          opacity: duration <= 0 ? 0.4 : isOtherActive ? 0.5 : 1,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (duration <= 0) return;
                          if (isActive) {
                            updateProjectData({ creditInTime: null, creditOutTime: null, creditAnimDuration: null, creditHoldStartMs: null, creditWipeStartMs: null, creditTitleLayout: 1 } as any);
                          } else {
                            const inTime = snapTimeToBeat(Math.max(0, currentTime));
                            const bpm = timelineBpmRef.current || project?.detectedBpm;
                            const beatMs = bpm && bpm > 0 ? (60 / bpm) * 1000 : null;
                            const baseAnimDur = beatMs ? beatMs * 16 : 6700;
                            const defaultWipeMs = beatMs ? beatMs * 12 : baseAnimDur * 3 / 4;
                            const outTime = calcCreditOutTime(duration, baseAnimDur);
                            updateProjectData({ creditInTime: inTime, creditOutTime: outTime, creditAnimDuration: baseAnimDur, creditWipeStartMs: defaultWipeMs, creditTitleLayout: layoutNum } as any);
                          }
                        }}
                        disabled={duration <= 0}
                        data-testid={`btn-title${layoutNum}-in`}
                        title={duration <= 0 ? "音楽を読み込んでください" : isActive ? `TITLE ${layoutNum === 1 ? "A" : "B"} を削除` : `現在位置に TITLE ${layoutNum === 1 ? "A" : "B"} IN を配置`}
                      >
                        {isActive ? `T${layoutNum === 1 ? "A" : "B"} ✕` : `＋ T${layoutNum === 1 ? "A" : "B"}`}
                      </button>
                    );
                  })}
                </div>
                <div className="px-2 py-1.5 grid gap-y-1" style={{ gridTemplateColumns: "20px 32px 20px 18px 1fr" }}>
                  {(() => {
                    const titleSize = project?.creditTitleFontSize ?? activePreset.creditTitleFontSize;
                    const rightTitleSize = project?.creditRightTitleFontSize ?? activePreset.creditRightTitleFontSize;
                    const rows = [
                      { label: "", sizeField: "creditTitleFontSize", size: titleSize, defaultSize: activePreset.creditTitleFontSize, sizeFields: { creditTitleFontSize: true }, items: [{ value: localSongTitle !== null ? localSongTitle : songTitle, setValue: setLocalSongTitle, field: "songTitle", testId: "input-song-title-credit", placeholder: "SONG TITLE", sub: "SONG", placeholderDark: true }] },
                      { label: "", sizeField: "creditLyricsFontSize", size: creditInfoSize, defaultSize: activePreset.creditInfoFontSize, sizeFields: { creditLyricsFontSize: true, creditMusicFontSize: true, creditArrangementFontSize: true, creditMembersFontSize: true }, items: [{ value: localMembersCredit !== null ? localMembersCredit : membersCredit, setValue: setLocalMembersCredit, field: "membersCredit", testId: "input-members-credit", placeholder: "MEMBER NAME", sub: "MEM", placeholderDark: true }] },
                      { label: "", sizeField: null, size: null, defaultSize: null, sizeFields: {}, items: [
                        { value: effectiveLyricsCredit, setValue: setLocalLyricsCredit, field: "lyricsCredit", testId: "input-lyrics-credit", placeholder: "作詞", sub: "作詞" },
                        { value: effectiveMusicCredit, setValue: setLocalMusicCredit, field: "musicCredit", testId: "input-music-credit", placeholder: "作曲", sub: "作曲" },
                        { value: effectiveArrangementCredit, setValue: setLocalArrangementCredit, field: "arrangementCredit", testId: "input-arrangement-credit", placeholder: "編曲", sub: "編曲" },
                      ]},
                      { label: "", sizeField: "creditRightTitleFontSize", size: rightTitleSize, defaultSize: activePreset.creditRightTitleFontSize, sizeFields: { creditRightTitleFontSize: true }, items: [{ value: "", setValue: () => {}, field: "_rightTitleDisplay", testId: "display-right-title", sub: "R SONG", readOnly: true }] },
                    ];
                    return rows.map((row, ri) => (
                      <Fragment key={ri}>
                        {row.sizeField ? (
                          <>
                            <button className="self-center flex items-center justify-center rounded border hover:bg-white/15 active:bg-white/25" style={{ width: 20, height: 20, color: "hsl(0 0% 68%)", fontSize: 13, borderColor: "hsl(0 0% 30%)", backgroundColor: "hsla(0, 0%, 18%, 0.4)" }} onClick={() => { const upd: any = {}; Object.keys(row.sizeFields).forEach(k => upd[k] = Math.max(12, row.size! - 2)); updateProjectData(upd); }} data-testid={`btn-size-minus-${row.sizeField}`} tabIndex={-1}>−</button>
                            <input type="text" inputMode="numeric" className="text-[13px] bg-transparent border-b outline-none text-center self-center" style={{ color: "hsl(0 0% 90%)", borderColor: "hsl(0 0% 32%)", width: 32 }} value={row.size!} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 12 && v <= 200) { const upd: any = {}; Object.keys(row.sizeFields).forEach(k => upd[k] = v); updateProjectData(upd); } }} onFocus={(e) => (e.target as HTMLInputElement).select()} data-testid={`input-size-${row.sizeField}`} />
                            <button className="self-center flex items-center justify-center rounded border hover:bg-white/15 active:bg-white/25" style={{ width: 20, height: 20, color: "hsl(0 0% 68%)", fontSize: 13, borderColor: "hsl(0 0% 30%)", backgroundColor: "hsla(0, 0%, 18%, 0.4)" }} onClick={() => { const upd: any = {}; Object.keys(row.sizeFields).forEach(k => upd[k] = Math.min(200, row.size! + 2)); updateProjectData(upd); }} data-testid={`btn-size-plus-${row.sizeField}`} tabIndex={-1}>+</button>
                            <button
                              className="self-center flex items-center justify-center rounded hover:bg-white/15 active:bg-white/25"
                              style={{ width: 18, height: 18, color: row.size === row.defaultSize ? "hsl(0 0% 30%)" : "hsl(0 0% 55%)", fontSize: 9, fontFamily: "monospace" }}
                              onClick={() => { const upd: any = {}; Object.keys(row.sizeFields).forEach(k => upd[k] = row.defaultSize); upd.fontSize = activePreset.fontSize; upd.strokeWidth = activePreset.strokeWidth; upd.strokeBlur = activePreset.strokeBlur; upd.creditTitleFontSize = activePreset.creditTitleFontSize; upd.creditLyricsFontSize = activePreset.creditInfoFontSize; upd.creditMusicFontSize = activePreset.creditInfoFontSize; upd.creditArrangementFontSize = activePreset.creditInfoFontSize; upd.creditMembersFontSize = activePreset.creditInfoFontSize; upd.creditRightTitleFontSize = activePreset.creditRightTitleFontSize; updateProjectData(upd); }}
                              title="全サイズをデフォルトに戻す"
                              data-testid={`btn-size-default-${row.sizeField}`}
                              tabIndex={-1}
                            >D</button>
                          </>
                        ) : (
                          <div className="col-span-4" style={{ minHeight: 0 }} />
                        )}
                        <div className="flex items-center gap-2 min-w-0 ml-1 self-center" style={row.items.length > 1 ? { borderBottom: "1px solid hsl(0 0% 30%)" } : undefined}>
                          {row.items.map((it: any) => (
                            <div key={it.field} className="flex items-center gap-1.5 min-w-0" style={{ flex: row.items.length === 1 ? "1 1 auto" : "1 1 0%" }}>
                              {it.sub && <span className="text-[11px] shrink-0 whitespace-nowrap" style={{ color: "hsl(0 0% 62%)", width: 28, textAlign: "right" }}>{it.sub}</span>}
                              {it.readOnly ? null : (
                                <input className={`text-[13px] bg-transparent outline-none flex-1 min-w-0${row.items.length === 1 ? " border-b" : ""}${it.placeholderDark ? " placeholder-dark" : ""}`} style={{ color: "hsl(0 0% 90%)", borderColor: "hsl(0 0% 30%)" }} value={it.value ?? ""} onChange={(e) => { it.setValue(e.target.value); debouncedCreditSave(it.field, e.target.value); }} onBlur={() => { flushCreditSave(it.field).then(() => { it.setValue(null); storage.getProject(id!).then(p => p && setProject(p)); }); }} data-testid={it.testId} placeholder={it.placeholder} />
                              )}
                            </div>
                          ))}
                        </div>
                      </Fragment>
                    ));
                  })()}
                </div>
              </div>
            );
          })()}

          <div
            className="overflow-hidden flex flex-col mx-2 mb-2 relative"
            style={{ border: "1px solid hsl(0 0% 20%)", backgroundColor: "hsl(0 0% 8%)", flex: "2 1 0%" }}
            data-testid="lyrics-drop-zone"
            onMouseDown={(e) => { const t = e.target as HTMLElement; if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") { const el = document.activeElement as HTMLElement; if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.blur(); } }}
            onDragEnter={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.stopPropagation();
                dragCounterRef.current++;
                setIsDraggingFile(true);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDragLeave={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              e.stopPropagation();
              dragCounterRef.current--;
              if (dragCounterRef.current <= 0) {
                dragCounterRef.current = 0;
                setIsDraggingFile(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragCounterRef.current = 0;
              setIsDraggingFile(false);
              const files = e.dataTransfer.files;
              if (files.length === 0 || uploadingLyrics) return;
              const file = files[0];
              const ext = file.name.split(".").pop()?.toLowerCase();
              if (ext === "telop") {
                importTelopToCurrentProject(file);
                return;
              }
              const allowed = ["docx", "xlsx", "xls", "txt", "pdf"];
              if (!ext || !allowed.includes(ext)) {
                toast({ title: "非対応のファイル形式です", description: "Word (.docx), Excel (.xlsx), テキスト (.txt), PDF に対応しています", variant: "destructive" });
                return;
              }
              uploadLyricsFile(file);
            }}
          >
            {isDraggingFile && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md pointer-events-none"
                style={{ border: "2px dashed hsl(0 0% 45%)", backgroundColor: "hsla(0, 0%, 12%, 0.85)" }}>
                <div className="text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(0 0% 65%)" }} />
                  <span className="text-sm font-medium" style={{ color: "hsl(0 0% 65%)" }}>
                    歌詞ファイルをドロップ
                  </span>
                  <p className="text-[10px] mt-1" style={{ color: "hsl(0 0% 55%)" }}>
                    .docx / .xlsx / .txt / .pdf
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2 py-1 shrink-0 select-none" style={{ borderBottom: "1px solid hsl(0 0% 20%)", background: "hsl(0 0% 11%)", minHeight: 28 }}>
              <div style={{ width: 12, flexShrink: 0 }} />
              <Type style={{ width: 14, height: 14, color: "hsl(48 100% 50%)" }} />
              <span className="text-[12px] font-bold tracking-widest uppercase" style={{ color: "hsl(48 100% 50%)" }}>
                Lyrics {lyrics ? `(${lyrics.length})` : ""}
              </span>
              <span className="text-[9px] ml-auto" style={{ color: "hsl(0 0% 42%)" }}>
                行番号をドラッグ→TL
              </span>
              <button
                tabIndex={-1}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
                style={{ color: "hsl(0 0% 50%)" }}
                onClick={() => setLyricsFullscreen(true)}
                title="歌詞フルスクリーン"
                data-testid="button-lyrics-fullscreen-open"
              >
                <Maximize className="w-3 h-3" />
              </button>
              {lyricsTextDirty && (
                <span className="text-[9px]" style={{ color: "hsl(0 0% 45%)" }}>
                  保存待ち...
                </span>
              )}
            </div>
            {isRecording ? (
              <div
                ref={recordingScrollRef}
                className="flex-1 overflow-y-auto"
                data-testid="recording-list"
              >
                <div className="p-2 space-y-1">
                  {lyricsText.split("\n").map((lineText, i) => {
                    const isBlank = lineText.trim() === "";
                    const isActive = i === recordingIndex;
                    const isPast = recordingIndex >= 0 && i < recordingIndex;
                    const recTiming = recordingTimings[i];
                    return (
                      <div
                        key={i}
                        data-rec-idx={i}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm transition-colors"
                        style={{
                          backgroundColor: isActive
                            ? "hsla(0, 55%, 22%, 0.7)"
                            : isPast
                              ? "hsla(0, 0%, 12%, 0.5)"
                              : "hsla(0, 0%, 14%, 0.4)",
                          border: isActive
                            ? "1px solid hsl(0 55% 40%)"
                            : "1px solid transparent",
                          opacity: isPast ? 0.4 : 1,
                        }}
                        data-testid={`rec-line-${i}`}
                      >
                        <span
                          className="text-[10px] font-mono shrink-0 text-right"
                          style={{
                            width: "1.5rem",
                            color: isActive ? "hsl(0 60% 60%)" : isPast ? "hsl(0 0% 25%)" : "hsl(0 0% 35%)",
                            fontWeight: isActive ? 700 : 400,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span
                          className="text-sm font-mono truncate"
                          style={{
                            color: isActive
                              ? "hsl(0 70% 80%)"
                              : isPast
                                ? "hsl(0 0% 30%)"
                                : isBlank
                                  ? "hsl(0 40% 35%)"
                                  : "hsl(0 0% 70%)",
                            fontStyle: isBlank ? "italic" : "normal",
                          }}
                        >
                          {isBlank ? "── blank ──" : lineText}
                        </span>
                        {recTiming && recTiming.startTime !== null && (
                          <span className="text-[9px] font-mono ml-auto shrink-0" style={{ color: "hsl(0 0% 30%)" }}>
                            {formatTime(recTiming.startTime)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
            <div className="flex-1 flex overflow-hidden">
              <div
                className="shrink-0 select-none overflow-hidden py-2"
                style={{ borderRight: "1px solid hsl(0 0% 22%)" }}
                ref={gutterRef}
                data-testid="lyrics-line-gutter"
              >
                {lyricsText.split("\n").map((lineText, i) => {
                  const lyricIdx = displayToLyricMap.get(i);
                  const lyricLine = lyricIdx !== undefined ? lyrics?.[lyricIdx] : undefined;
                  const isSelected = lyricLine ? timelineSelectedIds.has(lyricLine.id) : false;
                  const isBlank = lineText.trim() === "";
                  const hasTiming = lyricLine ? lyricLine.startTime !== null : false;
                  const isActive = i === activeDisplayIndex;
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-0.5 pr-1.5 pl-1 ${lyricLine ? "cursor-grab active:cursor-grabbing" : ""}`}
                      draggable={!!lyricLine}
                      onDragStart={(e) => {
                        if (!lyricLine) { e.preventDefault(); return; }
                        e.dataTransfer.setData("application/x-lyric-id", lyricLine.id);
                        e.dataTransfer.effectAllowed = "copy";
                        (window as any).__dragLyricText = lyricLine.text || "";
                      }}
                      onDragEnd={() => { (window as any).__dragLyricText = undefined; }}
                      style={{
                        height: "1.625rem",
                        lineHeight: "1.625rem",
                        fontSize: "10px",
                        fontFamily: "monospace",
                        backgroundColor: isSelected
                          ? "hsla(48, 50%, 20%, 0.4)"
                          : isActive
                            ? "hsla(48, 60%, 18%, 0.5)"
                            : "transparent",
                        borderLeft: isActive
                          ? "2px solid hsl(48 100% 50%)"
                          : "2px solid transparent",
                      }}
                      title={lyricLine ? (hasTiming ? "配置済み（再ドラッグで上書き）" : "タイムラインにドラッグ") : undefined}
                      data-testid={`gutter-line-${i}`}
                    >
                      <span
                        className="text-right shrink-0"
                        style={{
                          width: "1.25rem",
                          color: isSelected
                            ? "hsl(0 0% 95%)"
                            : isActive
                              ? "hsl(48 100% 55%)"
                              : isBlank
                                ? "hsl(0 55% 55%)"
                                : "hsl(0 0% 62%)",
                          fontWeight: isSelected || isActive ? 700 : 400,
                        }}
                      >
                        {i + 1}
                      </span>
                      {isBlank && (
                        <span style={{ width: "100%", height: "1px", backgroundColor: "hsl(0 0% 18%)", display: "block", margin: "0 2px" }} />
                      )}
                      {!isBlank && hasTiming && (
                        <span style={{ color: "hsl(0 0% 25%)", fontSize: "8px" }}>✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex-1 relative overflow-hidden">
                <Textarea
                  ref={lyricsTextareaRef}
                  placeholder={"歌詞を入力またはファイルから読み込み\n（1行ずつ入力してください）\n\n空行はブランク（間奏）として扱われます"}
                  value={lyricsText}
                  onChange={(e) => {
                    const val = e.target.value;
                    const prev = lyricsTextRef.current;
                    if (prev !== val) {
                      const now = Date.now();
                      const timeSinceLastPush = now - textUndoLastPushRef.current;
                      const isStructural = prev.split("\n").length !== val.split("\n").length;
                      if (isStructural || timeSinceLastPush > 800) {
                        pushTextUndo(prev, e.target.selectionStart, e.target.selectionEnd);
                      }
                    }
                    setLyricsText(val);
                    lyricsTextRef.current = val;
                    setLyricsTextDirty(true);
                    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                    autoSaveTimerRef.current = setTimeout(() => {
                      if (val.trim()) {
                        saveLyricsToDb(val);
                      }
                    }, 1500);
                  }}
                  onFocus={(e) => {
                    const ta = e.target as HTMLTextAreaElement;
                    if (textUndoStackRef.current.length === 0) {
                      pushTextUndo(ta.value, ta.selectionStart, ta.selectionEnd);
                    }
                  }}
                  onKeyDown={(e) => {
                    const ta = e.target as HTMLTextAreaElement;
                    const k = e.key.toLowerCase();
                    const isUndoRedo = (e.metaKey || e.ctrlKey) && (
                      (k === "z") ||
                      (!e.metaKey && e.ctrlKey && k === "y")
                    );
                    if (!isUndoRedo) return;
                    const isRedo = (k === "z" && e.shiftKey) || (k === "y");
                    e.preventDefault();
                    e.stopPropagation();
                    const applyEntry = (entry: { text: string; selStart: number; selEnd: number }) => {
                      setLyricsText(entry.text);
                      lyricsTextRef.current = entry.text;
                      setLyricsTextDirty(true);
                      requestAnimationFrame(() => {
                        ta.selectionStart = entry.selStart;
                        ta.selectionEnd = entry.selEnd;
                      });
                      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                      autoSaveTimerRef.current = setTimeout(() => {
                        if (entry.text.trim()) saveLyricsToDb(entry.text);
                      }, 1500);
                    };
                    if (isRedo) {
                      const stack = textRedoStackRef.current;
                      if (stack.length === 0) return;
                      pushTextUndo(lyricsTextRef.current, ta.selectionStart, ta.selectionEnd, true);
                      applyEntry(stack.pop()!);
                    } else {
                      const stack = textUndoStackRef.current;
                      if (stack.length === 0) return;
                      textRedoStackRef.current.push({ text: lyricsTextRef.current, selStart: ta.selectionStart, selEnd: ta.selectionEnd });
                      applyEntry(stack.pop()!);
                    }
                  }}
                  onScroll={() => {
                    if (lyricsTextareaRef.current) {
                      const st = lyricsTextareaRef.current.scrollTop;
                      if (gutterRef.current) gutterRef.current.scrollTop = st;
                      setLyricsScrollTop(st);
                    }
                  }}
                  className="w-full h-full text-sm resize-none border-0 rounded-none focus-visible:ring-0"
                  style={{ lineHeight: "1.625rem" }}
                  data-testid="textarea-lyrics"
                />
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {activeDisplayIndex >= 0 && (() => {
                    const ta = lyricsTextareaRef.current;
                    const scrollY = ta ? ta.scrollTop : lyricsScrollTop;
                    const top = activeDisplayIndex * 26 + 8 - scrollY;
                    if (top >= -26 && top <= 600) {
                      return (
                        <div
                          key="active-highlight"
                          className="absolute"
                          style={{
                            top: `${top}px`,
                            left: 0,
                            right: 0,
                            height: "1.625rem",
                            backgroundColor: "hsla(48, 60%, 18%, 0.5)",
                            borderRight: "2px solid hsl(48 100% 50%)",
                          }}
                        />
                      );
                    }
                    return null;
                  })()}
                  {lyricsText.split("\n").map((line, i) => {
                    if (line.trim() !== "") return null;
                    const top = i * 26 + 8 - lyricsScrollTop;
                    if (top < -26 || top > 600) return null;
                    return (
                      <div
                        key={`blank-${i}`}
                        className="absolute flex items-center justify-center"
                        style={{
                          top: `${top}px`,
                          left: 0,
                          right: 0,
                          height: "1.625rem",
                        }}
                      >
                        <span
                          className="text-[9px] font-mono tracking-wider uppercase"
                          style={{ color: "hsl(0 0% 20%)", opacity: 0.5 }}
                        >
                          ──
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
        </div>

        <div className="shrink-0 overflow-hidden" style={{ height: "234px", border: "1px solid hsl(0 0% 22%)" }}>
            <TimelineEditor
              projectId={id!}
              lyrics={lyrics || []}
              accentHue={accentHue}
              audioRef={audioRef}
              audioUrl={audioUrl}
              audioArrayBuffer={audioArrayBuffer}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              togglePlay={togglePlay}
              stopPlayback={stopPlayback}
              seekTo={seekTo}
              onTimingsUpdated={handleTimingsUpdated}
              onFadesUpdated={(fades) => updateFades(fades)}
              hasAudio={!!audioUrl}
              audioTrimStart={project?.audioTrimStart ?? 0}
              audioTracks={audioTracks}
              activeAudioTrackId={project?.activeAudioTrackId ?? null}
              onSwitchAudioTrack={handleSwitchAudioTrack}
              onDeleteAudioTrack={handleDeleteAudioTrack}
              onRenameAudioTrack={handleRenameAudioTrack}
              onTrimStartChange={(trimStart) => {
                updateProjectData({ audioTrimStart: trimStart } as Partial<Project>);
              }}
              recordingTimings={recordingTimings}
              isRecording={isRecording}
              recordingIndex={recordingIndex}
              songTitle={songTitle}
              creditInTime={project?.creditInTime}
              creditOutTime={project?.creditOutTime}
              onCreditTimingChange={(inTime, outTime) => {
                updateProjectData({ creditInTime: inTime, creditOutTime: outTime } as any);
              }}
              creditAnimDuration={project?.creditAnimDuration}
              onCreditAnimDurationChange={(dur) => {
                updateProjectData({ creditAnimDuration: dur } as any);
              }}
              creditHoldStartMs={project?.creditHoldStartMs}
              onCreditHoldStartMsChange={(ms) => {
                updateProjectData({ creditHoldStartMs: ms } as any);
              }}
              onHoldStartWithWipeAndDurationChange={(holdMs, wipeMs, animDur) => {
                updateProjectData({ creditHoldStartMs: holdMs, creditWipeStartMs: wipeMs, creditAnimDuration: animDur } as any);
              }}
              creditWipeStartMs={project?.creditWipeStartMs}
              onCreditWipeStartMsChange={(ms) => {
                updateProjectData({ creditWipeStartMs: ms } as any);
              }}
              onWipeStartWithDurationChange={(wipeMs, animDur) => {
                updateProjectData({ creditWipeStartMs: wipeMs, creditAnimDuration: animDur } as any);
              }}
              onCreditDelete={() => {
                updateProjectData({ creditInTime: null, creditOutTime: null, creditAnimDuration: null, creditHoldStartMs: null, creditWipeStartMs: null } as any);
              }}
              onAudioDrop={handleAudioDrop}
              volumeRef={volumeRef}
              savedBpm={project?.detectedBpm ?? null}
              onSelectionChange={setTimelineSelectedIds}
              bpmGridOffset={project?.bpmGridOffset ?? 0}
              onBpmGridOffsetChange={(offset) => {
                updateProjectData({ bpmGridOffset: offset } as any);
              }}
              creditDragActive={creditDragActive}
              onCreditDragEnd={() => setCreditDragActive(false)}
              onWaveformEndDetected={handleWaveformEndDetected}
              onPasteLyrics={async (lines) => {
                if (!id) return;
                const newLines = await storage.addLyricLines(id, lines);
                setLyrics(prev => prev ? [...prev, ...newLines] : newLines);
              }}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={async () => { const d = await undo(); if (d) toast({ title: `元に戻しました: ${d}` }); return d; }}
              onRedo={async () => { const d = await redo(); if (d) toast({ title: `やり直しました: ${d}` }); return d; }}
              undoDescription={undoDescription}
              redoDescription={redoDescription}
              markers={checkMarkers}
              onMarkersChange={setCheckMarkers}
              zoomOutLabel={codeToLabel(resolvedKeyMap.zoomOut)}
              zoomInLabel={codeToLabel(resolvedKeyMap.zoomIn)}
              rightTitleText={(project?.creditRightTitle || project?.songTitle || "").trim()}
            />
        </div>
      </div>

      <footer className="flex items-center justify-between px-3 py-1 shrink-0" style={{ backgroundColor: "hsl(0 0% 9%)", border: "1px solid hsl(0 0% 22%)" }}>
        <span className="text-[10px] tracking-wider" style={{ color: "hsl(0 0% 50%)" }}>Telop Studio</span>
        <span className="text-[10px] tracking-wider" style={{ color: "hsl(0 0% 50%)" }}>1920 × 1080</span>
      </footer>

      {previewFullscreen && (
        <FullscreenPreview
          sourceCanvasRef={canvasRef}
          onClose={() => setPreviewFullscreen(false)}
          isPlaying={isPlaying}
          audioRef={audioRef}
          currentTime={currentTime}
          duration={duration}
          seekTo={seekTo}
          previewBgMode={previewBgMode}
          onToggleBgMode={() => setPreviewBgMode(prev => prev === "checker" ? "color" : "checker")}
          styleProps={{
            fontFamily,
            fontSize: effectiveFontSize,
            fontColor: effectiveFontColor,
            strokeColor: effectiveStrokeColor,
            strokeWidth: strokeWidthVal,
            strokeBlur: strokeBlurVal,
            textAlign,
            accentHue,
            fonts: FONTS,
            onChangeFontFamily: (v) => updateProjectData({ fontFamily: v }),
            onChangeFontSize: changeFontSize,
            onChangeFontColor: (c) => { setLocalFontColor(c); debouncedColorSave("fontColor", c); },
            onChangeStrokeColor: (c) => { setLocalStrokeColor(c); debouncedColorSave("strokeColor", c); },
            onChangeStrokeWidth: (v) => updateProjectData({ strokeWidth: v }),
            onChangeStrokeBlur: (v) => updateProjectData({ strokeBlur: v }),
            onChangeTextAlign: (a) => updateProjectData({ textAlign: a, textX: null }),
          }}
        />
      )}

      {lyricsFullscreen && (
        <FullscreenLyricsEditor
          lyricsText={lyricsText}
          onLyricsChange={(val) => {
            const prev = lyricsTextRef.current;
            if (prev !== val) {
              const now = Date.now();
              const timeSinceLastPush = now - textUndoLastPushRef.current;
              const isStructural = prev.split("\n").length !== val.split("\n").length;
              if (isStructural || timeSinceLastPush > 800) {
                pushTextUndo(prev);
              }
            }
            setLyricsText(val);
            lyricsTextRef.current = val;
            setLyricsTextDirty(true);
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = setTimeout(() => {
              if (val.trim()) saveLyricsToDb(val);
            }, 1500);
          }}
          lyrics={lyrics}
          activeLyricIndex={activeDisplayIndex}
          accentHue={accentHue}
          audioRef={audioRef}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          seekTo={seekTo}
          onClose={() => setLyricsFullscreen(false)}
        />
      )}


      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        project={project}
        presetConfig={{
          creditFontWeight: activePreset.creditFontWeight,
          creditBaseXRatio: activePreset.creditBaseXRatio,
          creditRightMarginRatio: activePreset.creditRightMarginRatio,
          creditCharDelay: activePreset.creditCharDelay,
          creditCharAnimDur: activePreset.creditCharAnimDur,
          creditRightCharDelay: activePreset.creditRightCharDelay,
          creditRightCharAnimDur: activePreset.creditRightCharAnimDur,
        }}
        lyrics={lyrics || []}
        audioUrl={audioUrl}
        audioFileName={project.audioFileName}
      />
      <MetadataDialog
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
        project={project}
        onSave={(data) => updateProjectData(data)}
        isPending={false}
      />
      <StyleSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={project}
        onSaved={() => storage.getProject(id!).then(p => p && setProject(p))}
      />
      <DropboxPicker
        open={dropboxPickerOpen}
        onClose={() => setDropboxPickerOpen(false)}
        onSelect={handleDropboxSelect}
        preset={project.preset}
      />
      <Dialog open={!!dropboxDuplicateDialog} onOpenChange={(open) => { if (!open) setDropboxDuplicateDialog(null); }}>
        <DialogContent className="max-w-md" style={{ backgroundColor: "hsl(0 0% 10%)", border: "1px solid hsl(48 100% 45% / 0.25)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "hsl(48 100% 50%)" }}>Dropboxに同名ファイルが存在します</DialogTitle>
            <DialogDescription>
              「{dropboxDuplicateDialog?.fileName}」は既にDropboxに保存されています。どうしますか？
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <Button
              onClick={() => handleDropboxDuplicateChoice("overwrite")}
              variant="destructive"
              data-testid="button-dropbox-overwrite"
            >
              上書き保存
            </Button>
            <Button
              onClick={() => handleDropboxDuplicateChoice("rename")}
              variant="outline"
              data-testid="button-dropbox-rename"
              style={{ borderColor: "hsl(48 100% 45% / 0.4)", color: "hsl(48 100% 50%)" }}
            >
              別名で保存（{dropboxDuplicateDialog?.suggestedName}）
            </Button>
            <Button
              onClick={() => handleDropboxDuplicateChoice("skip")}
              variant="ghost"
              data-testid="button-dropbox-skip"
            >
              Dropboxに保存しない
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={shortcutsOpen} onOpenChange={(open) => { setShortcutsOpen(open); if (!open) setEditingShortcut(null); }}>
        <DialogContent className="max-w-sm" style={{ backgroundColor: "hsl(0 0% 10%)", border: "1px solid hsl(0 0% 25%)" }}
          onKeyDown={(e) => {
            if (editingShortcut) {
              e.preventDefault();
              e.stopPropagation();
              if (e.code !== "Escape") {
                updateShortcut(editingShortcut, e.code);
              } else {
                setEditingShortcut(null);
              }
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>ショートカット一覧</span>
              <button
                className="text-[10px] font-mono px-2 py-1 rounded hover:bg-white/10"
                style={{ color: "hsl(0 0% 50%)" }}
                onClick={resetShortcuts}
                data-testid="button-reset-shortcuts"
              >リセット</button>
            </DialogTitle>
            <DialogDescription className="text-xs" style={{ color: "hsl(0 0% 45%)" }}>キーをクリックして変更</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" style={{ color: "hsl(0 0% 75%)" }}>
            {([
              ["playPause", "再生 / 一時停止"],
              ["seekStart", "先頭に戻る"],
              ["zoomOut", "ズームアウト"],
              ["zoomIn", "ズームイン"],
              ["seekBack", "1小節戻る"],
              ["seekForward", "1小節進む"],
              ["marker", "チェックマーカー配置"],
              ["fadeMode", "フェードモード切替"],
              ["titleIn", "TITLE A IN 配置/削除"],
              ["title2In", "TITLE B IN 配置/削除"],
              ["fullscreen", "フルスクリーンプレビュー"],
            ] as [string, string][]).map(([action, desc]) => (
              <Fragment key={action}>
                <kbd
                  className="text-xs font-mono font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                  style={{
                    backgroundColor: editingShortcut === action ? "hsl(48 100% 30%)" : customKeyMap[action] ? "hsl(200 40% 18%)" : "hsl(0 0% 18%)",
                    border: editingShortcut === action ? "1px solid hsl(48 100% 50%)" : "1px solid hsl(0 0% 30%)",
                    color: editingShortcut === action ? "hsl(48 100% 85%)" : "hsl(0 0% 90%)",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => setEditingShortcut(editingShortcut === action ? null : action)}
                  data-testid={`kbd-${action}`}
                >
                  {editingShortcut === action ? "キーを押す..." : codeToLabel(resolvedKeyMap[action])}
                </kbd>
                <span>{desc}</span>
              </Fragment>
            ))}
            {([
              ["Del / BS", "選択マーカー削除"],
              ["Ctrl+Z", "元に戻す"],
              ["Ctrl+Shift+Z", "やり直し"],
            ] as [string, string][]).map(([key, desc]) => (
              <Fragment key={key}>
                <kbd className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 30%)", color: "hsl(0 0% 90%)", whiteSpace: "nowrap" }}>{key}</kbd>
                <span>{desc}</span>
              </Fragment>
            ))}
            <div className="col-span-2 mt-2 pt-2" style={{ borderTop: "1px solid hsl(0 0% 20%)" }}>
              <span className="text-xs" style={{ color: "hsl(0 0% 45%)" }}>録音中</span>
            </div>
            {([
              ["Space / → / Enter", "次の行へ"],
              ["Esc", "録音停止"],
            ] as [string, string][]).map(([key, desc]) => (
              <Fragment key={key}>
                <kbd className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 30%)", color: "hsl(0 0% 90%)", whiteSpace: "nowrap" }}>{key}</kbd>
                <span>{desc}</span>
              </Fragment>
            ))}
            <div className="col-span-2 mt-2 pt-2" style={{ borderTop: "1px solid hsl(0 0% 20%)" }}>
              <span className="text-xs" style={{ color: "hsl(0 0% 45%)" }}>タイムライン</span>
            </div>
            {([
              ["Shift/⌘+ドラッグ", "マーカー範囲選択"],
              ["Shift+クリック", "マーカー複数選択"],
            ] as [string, string][]).map(([key, desc]) => (
              <Fragment key={key}>
                <kbd className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "hsl(0 0% 18%)", border: "1px solid hsl(0 0% 30%)", color: "hsl(0 0% 90%)", whiteSpace: "nowrap" }}>{key}</kbd>
                <span>{desc}</span>
              </Fragment>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
