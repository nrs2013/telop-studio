import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Circle, Square, SkipForward, RotateCcw } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import type { LyricLine } from "@shared/schema";

interface RecordingModeProps {
  projectId: string;
  lyrics: LyricLine[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  seekTo: (time: number) => void;
  onTimingsRecorded: (timings: { id: string; startTime: number | null; endTime: number | null }[]) => void;
  hasAudio: boolean;
}

export function RecordingMode({
  projectId,
  lyrics,
  audioRef,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  seekTo,
  onTimingsRecorded,
  hasAudio,
}: RecordingModeProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [timings, setTimings] = useState<{ id: string; startTime: number | null; endTime: number | null }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRecording && currentIndex >= 0 && scrollRef.current) {
      const el = scrollRef.current.children[currentIndex] as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentIndex, isRecording]);

  const startRecording = useCallback(() => {
    if (!hasAudio || lyrics.length === 0) return;
    const audio = audioRef.current;
    if (!audio) return;

    setTimings(lyrics.map((l) => ({ id: l.id, startTime: null, endTime: null })));
    setCurrentIndex(0);
    setIsRecording(true);
    audio.currentTime = 0;
    audio.play();
  }, [hasAudio, lyrics, audioRef]);

  const advanceLine = useCallback(() => {
    if (!isRecording) return;
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;

    setTimings((prev) => {
      const next = [...prev];
      if (currentIndex >= 0 && currentIndex < next.length) {
        if (next[currentIndex].startTime === null) {
          next[currentIndex].startTime = time;
        }
        next[currentIndex].endTime = time;
      }
      if (currentIndex + 1 < next.length) {
        next[currentIndex + 1].startTime = time;
      }
      return next;
    });

    if (currentIndex + 1 >= lyrics.length) {
      stopRecording();
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [isRecording, currentIndex, lyrics.length, audioRef]);

  const stopRecording = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      const time = audio.currentTime;
      setTimings((prev) => {
        const next = [...prev];
        if (currentIndex >= 0 && currentIndex < next.length && next[currentIndex].endTime === null) {
          next[currentIndex].endTime = time;
        }
        return next;
      });
      audio.pause();
    }
    setIsRecording(false);
  }, [audioRef, currentIndex]);

  const saveTimings = useCallback(() => {
    onTimingsRecorded(timings);
  }, [timings, onTimingsRecorded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isRecording) return;
      if (e.code === "Space" || e.code === "ArrowRight" || e.code === "Enter") {
        e.preventDefault();
        advanceLine();
      }
      if (e.code === "Escape") {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, advanceLine, stopRecording]);

  if (!hasAudio) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-muted-foreground">
          録画を始めるには、まず音楽ファイルをアップロードしてください
        </p>
      </div>
    );
  }

  if (lyrics.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-muted-foreground">
          録画を始めるには、まず歌詞を読み込んでください
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <h3 className="text-sm font-medium">タイミング録画</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              音楽を再生しながら、歌詞の切り替えタイミングを記録します
            </p>
          </div>
          {isRecording && (
            <Badge variant="destructive" className="animate-pulse" data-testid="badge-recording">
              <Circle className="w-2.5 h-2.5 mr-1 fill-current" />
              REC
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isRecording ? (
            <>
              <Button onClick={startRecording} data-testid="button-start-recording">
                <Circle className="w-4 h-4 mr-2" />
                録画開始
              </Button>
              {timings.some((t) => t.startTime !== null) && (
                <Button variant="outline" onClick={saveTimings} data-testid="button-save-timings">
                  タイミングを保存
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={stopRecording}
                data-testid="button-stop-recording"
              >
                <Square className="w-4 h-4 mr-2" />
                停止
              </Button>
              <Button
                variant="outline"
                onClick={advanceLine}
                data-testid="button-advance"
              >
                <SkipForward className="w-4 h-4 mr-2" />
                次の行
              </Button>
            </>
          )}
        </div>

        {isRecording && (
          <div className="mt-3 text-xs text-muted-foreground">
            スペースキー / Enterキー / 右矢印キーで次の行へ進めます
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div ref={scrollRef} className="space-y-1 max-h-[50vh] overflow-y-auto">
          {lyrics.map((line, i) => {
            const isActive = isRecording && i === currentIndex;
            const isPast = isRecording && i < currentIndex;
            const timing = timings[i];
            return (
              <div
                key={line.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : isPast
                      ? "text-muted-foreground"
                      : ""
                }`}
                data-testid={`recording-line-${i}`}
              >
                <span className="text-xs font-mono w-6 text-right shrink-0 text-muted-foreground">
                  {i + 1}
                </span>
                <span className={`flex-1 text-sm ${isActive ? "font-medium" : ""}`}>
                  {line.text}
                </span>
                {timing && timing.startTime !== null && (
                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                    {formatTime(timing.startTime)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
