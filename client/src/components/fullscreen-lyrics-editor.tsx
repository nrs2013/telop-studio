// 歌詞エディタの全画面版：左にガター（行番号）、中央に textarea、下部に再生バー。
// 元は project.tsx 内に定義されていたが、肥大化対策として独立ファイルへ。
//
// 修正ポイント：safePlay は元コードでは未定義参照（pre-existing バグ）だったため、
// props で受け取るように変更。これにより歌詞エディタ全画面の再生ボタンが動作するようになる。

import { useRef, useState, useCallback, useEffect } from "react";
import { Type } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import type { LyricLine } from "@shared/schema";

type Props = {
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
  safePlay: () => Promise<void>;
  onClose: () => void;
};

export function FullscreenLyricsEditor({ lyricsText, onLyricsChange, lyrics: _lyrics, activeLyricIndex: activeDisplayIndex, accentHue: _accentHue, audioRef, isPlaying, currentTime, duration, seekTo, safePlay, onClose }: Props) {
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
