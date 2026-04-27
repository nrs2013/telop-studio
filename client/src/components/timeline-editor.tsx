import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, X, Loader2, Magnet, Play, Pause, Square, Blend, SkipBack, SkipForward, Undo2, Redo2 } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import { detectBPM, detectBPMFromSamples } from "@/lib/bpmDetect";
import type { LyricLine } from "@shared/schema";
import AudioWorkerModule from "@/lib/audioWorker?worker";
const createAudioWorker = (): Worker | null => {
  try {
    return new AudioWorkerModule();
  } catch { return null; }
};

interface TimelineEditorProps {
  projectId: string;
  lyrics: LyricLine[];
  accentHue?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  audioUrl: string | null;
  audioArrayBuffer: ArrayBuffer | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  togglePlay: () => void;
  stopPlayback: () => void;
  seekTo: (time: number) => void;
  onTimingsUpdated: (timings: { id: string; startTime: number | null; endTime: number | null }[]) => void;
  onFadesUpdated: (fades: { id: string; fadeIn: number; fadeOut: number }[]) => void;
  hasAudio: boolean;
  audioTrimStart: number;
  onTrimStartChange: (trimStart: number) => void;
  recordingTimings?: { id: string; startTime: number | null; endTime: number | null }[];
  isRecording?: boolean;
  recordingIndex?: number;
  songTitle?: string;
  creditInTime?: number | null;
  creditOutTime?: number | null;
  onCreditTimingChange?: (inTime: number | null, outTime: number | null) => void;
  creditAnimDuration?: number | null;
  onCreditAnimDurationChange?: (dur: number) => void;
  creditHoldStartMs?: number | null;
  onCreditHoldStartMsChange?: (ms: number) => void;
  onHoldStartWithWipeAndDurationChange?: (holdMs: number, wipeMs: number, animDur: number) => void;
  creditWipeStartMs?: number | null;
  onCreditWipeStartMsChange?: (ms: number) => void;
  onWipeStartWithDurationChange?: (wipeMs: number, animDur: number) => void;
  onCreditDelete?: () => void;
  onAudioDrop?: (file: File) => void;
  audioTracks?: { id: string; label: string; fileName: string; createdAt: string }[];
  activeAudioTrackId?: string | null;
  onSwitchAudioTrack?: (trackId: string) => void;
  onDeleteAudioTrack?: (trackId: string) => void;
  onRenameAudioTrack?: (trackId: string, label: string) => void;
  savedBpm?: number | null;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  bpmGridOffset?: number;
  onBpmGridOffsetChange?: (offset: number) => void;
  creditDragActive?: boolean;
  onCreditDragEnd?: () => void;
  onWaveformEndDetected?: (endTime: number) => void;
  onPasteLyrics?: (lines: { text: string; startTime: number; endTime: number; fadeIn: number; fadeOut: number }[]) => void;
  volumeRef?: React.MutableRefObject<number>;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => Promise<string | undefined>;
  onRedo?: () => Promise<string | undefined>;
  undoDescription?: string;
  redoDescription?: string;
  markers?: { id: string; time: number }[];
  onMarkersChange?: (markers: { id: string; time: number }[]) => void;
  zoomOutLabel?: string;
  zoomInLabel?: string;
  rightTitleAnimDurMs?: number;
  rightTitleText?: string;
  scoreRows?: { id: string; section: string; bars: string; lyric: string }[];
  sectionBlocks?: { id: string; label: string; startBar: number; endBar: number }[];
  onSectionBlocksChange?: (blocks: { id: string; label: string; startBar: number; endBar: number }[]) => void;
  /** リハーサルマーク帯の空白部分をダブルクリックした時に呼ばれる。bar = タイムライン小節位置 */
  onSectionAddAt?: (atBar: number) => void;
}

let decodedCache: { projectId: string; bufferByteLength: number; channelData: Float32Array; sampleRate: number } | null = null;

let clipboardBlocks: { text: string; relativeStart: number; relativeEnd: number; fadeIn: number; fadeOut: number }[] = [];

function detectSilenceEnd(peaks: Float32Array, peaksPerSecond: number, threshold = 0.02): number {
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > threshold) {
      return Math.max(0, i / peaksPerSecond - 0.1);
    }
  }
  return 0;
}

function detectWaveformEnd(peaks: Float32Array, peaksPerSecond: number, totalDuration: number, threshold = 0.02): number {
  for (let i = peaks.length - 1; i >= 0; i--) {
    if (peaks[i] > threshold) {
      return Math.min(totalDuration, (i + 1) / peaksPerSecond);
    }
  }
  return totalDuration;
}

const COLORS = [
  "hsl(210, 70%, 28%)",
  "hsl(160, 60%, 24%)",
  "hsl(35, 75%, 28%)",
  "hsl(280, 55%, 30%)",
  "hsl(190, 65%, 26%)",
  "hsl(350, 60%, 28%)",
  "hsl(120, 50%, 24%)",
  "hsl(55, 65%, 28%)",
];

export const TimelineEditor = memo(function TimelineEditor({
  projectId,
  lyrics,
  accentHue: propAccentHue,
  audioRef,
  audioUrl,
  audioArrayBuffer,
  isPlaying,
  currentTime,
  duration,
  togglePlay,
  stopPlayback,
  seekTo,
  onTimingsUpdated,
  onFadesUpdated,
  hasAudio,
  audioTrimStart,
  onTrimStartChange,
  recordingTimings,
  isRecording: isRec,
  recordingIndex: recIdx,
  songTitle,
  creditInTime,
  creditOutTime,
  onCreditTimingChange,
  creditAnimDuration,
  onCreditAnimDurationChange,
  creditHoldStartMs,
  onCreditHoldStartMsChange,
  onHoldStartWithWipeAndDurationChange,
  creditWipeStartMs,
  onCreditWipeStartMsChange,
  onWipeStartWithDurationChange,
  onCreditDelete,
  onAudioDrop,
  audioTracks,
  activeAudioTrackId,
  onSwitchAudioTrack,
  onDeleteAudioTrack,
  onRenameAudioTrack,
  savedBpm,
  onSelectionChange,
  bpmGridOffset: savedGridOffset,
  onBpmGridOffsetChange,
  creditDragActive,
  onCreditDragEnd,
  onWaveformEndDetected,
  onPasteLyrics,
  volumeRef: externalVolumeRef,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoDescription,
  redoDescription,
  markers,
  onMarkersChange,
  zoomOutLabel,
  zoomInLabel,
  rightTitleAnimDurMs,
  rightTitleText,
  scoreRows,
  sectionBlocks,
  onSectionBlocksChange,
  onSectionAddAt,
}: TimelineEditorProps) {
  const aHue = propAccentHue ?? 270;
  const [zoom, setZoom] = useState(50);
  // タイムライン scroll 同期用（SECTION マーカー帯を横スクロールに追従させる）
  const [tlScrollLeft, setTlScrollLeft] = useState(0);
  const zoomScrollSuppressRef = useRef(0);
  const zoomIntendedScrollRef = useRef(-1);
  const [fadeInTime, setFadeInTime] = useState(1);
  const [fadeOutTime, setFadeOutTime] = useState(1);
  const [fadeTimeInput, setFadeTimeInput] = useState("1");
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [fadeMode, setFadeMode] = useState(false);
  const [selectedMarkerIds, setSelectedMarkerIds] = useState<Set<string>>(new Set());
  const [markerSelectRect, setMarkerSelectRect] = useState<{ startX: number; endX: number } | null>(null);
  const markerDragRef = useRef<{ id: string; origTime: number; startX: number } | null>(null);
  const markerSelectStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const onMarkersChangeRef = useRef(onMarkersChange);
  onMarkersChangeRef.current = onMarkersChange;
  const ensureFullVolume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.volume = 1.0;
    }
    if (externalVolumeRef) externalVolumeRef.current = 1.0;
  }, [audioRef, externalVolumeRef]);

  useEffect(() => {
    ensureFullVolume();
  }, [ensureFullVolume]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
      setAudioDragOver(true);
    } else if (e.dataTransfer.types.includes("application/x-lyric-id") || e.dataTransfer.types.includes("application/x-credit-title")) {
      e.preventDefault();
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setAudioDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    setAudioDragOver(false);
    if (!e.dataTransfer.types.includes("Files")) return;
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    const file = files[0];
    const fext = file.name.split(".").pop()?.toLowerCase() || "";
    if (fext === "telop") return;
    e.preventDefault();
    e.stopPropagation();
    const audioExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "opus", "webm", "mp4"];
    if (!file.type.startsWith("audio/") && !audioExts.includes(fext)) return;
    onAudioDrop?.(file);
  }, [onAudioDrop]);

  const displayLyrics = useMemo(() => {
    if (!isRec || !recordingTimings) return lyrics;
    return lyrics.map((l) => {
      const rt = recordingTimings.find((r) => r.id === l.id);
      if (rt && (rt.startTime !== null || rt.endTime !== null)) {
        return { ...l, startTime: rt.startTime, endTime: rt.endTime };
      }
      return l;
    });
  }, [lyrics, isRec, recordingTimings]);

  const timelineRef = useRef<HTMLDivElement>(null);

  const baseZoomSteps = [2, 4, 8, 14, 22, 32, 46, 64, 90, 120, 158, 200];
  const zoomLastStepRef = useRef(0);

  const getMinZoom = useCallback(() => {
    const el = timelineRef.current;
    if (!el || duration <= 0) return baseZoomSteps[0];
    return Math.max(1, Math.floor(el.clientWidth / duration));
  }, [duration]);

  const getZoomSteps = useCallback(() => {
    const minZ = getMinZoom();
    const steps = [minZ, ...baseZoomSteps.filter(s => s > minZ)];
    return steps;
  }, [getMinZoom]);

  const zoomAroundPlayhead = useCallback((direction: "in" | "out") => {
    const now = Date.now();
    const elapsed = now - zoomLastStepRef.current;
    if (elapsed < 120) return;
    zoomLastStepRef.current = now;
    const zoomSteps = getZoomSteps();
    setZoom((prev) => {
      let idx = 0;
      let minDist = Infinity;
      for (let i = 0; i < zoomSteps.length; i++) {
        const d = Math.abs(zoomSteps[i] - prev);
        if (d < minDist) { minDist = d; idx = i; }
      }
      const nextIdx = direction === "in" ? Math.min(zoomSteps.length - 1, idx + 1) : Math.max(0, idx - 1);
      const next = zoomSteps[nextIdx];
      if (next === prev) return prev;
      const ct = currentTimeRef.current;
      const el = timelineRef.current;
      if (el) {
        const newScroll = Math.max(0, ct * next - el.clientWidth / 2);
        zoomIntendedScrollRef.current = newScroll;
        zoomScrollSuppressRef.current = Date.now();
        el.scrollLeft = newScroll;
      }
      return next;
    });
  }, [getZoomSteps]);

  useEffect(() => {
    const handler = (e: Event) => {
      const dir = (e as CustomEvent).detail as "in" | "out";
      zoomAroundPlayhead(dir);
    };
    window.addEventListener("timeline-zoom", handler);
    return () => window.removeEventListener("timeline-zoom", handler);
  }, [zoomAroundPlayhead]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (isSeekDraggingRef.current || isDraggingRef.current || rulerDraggingRef.current) return;
      if (Date.now() - zoomScrollSuppressRef.current < 500) return;
      const time = (e as CustomEvent).detail as number;
      const el = timelineRef.current;
      if (!el) return;
      const playheadX = time * zoom;
      const viewportW = el.clientWidth;
      el.scrollLeft = Math.max(0, playheadX - viewportW / 2);
    };
    window.addEventListener("timeline-scroll-to-time", handler);
    return () => window.removeEventListener("timeline-scroll-to-time", handler);
  }, [zoom]);

  useEffect(() => {
    const onOn = () => setFadeMode(true);
    const onOff = () => setFadeMode(false);
    window.addEventListener("timeline-fade-mode-on", onOn);
    window.addEventListener("timeline-fade-mode-off", onOff);
    return () => {
      window.removeEventListener("timeline-fade-mode-on", onOn);
      window.removeEventListener("timeline-fade-mode-off", onOff);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (selectedMarkerIds.size === 0) return;
      const remaining = (markers || []).filter(m => !selectedMarkerIds.has(m.id));
      onMarkersChangeRef.current?.(remaining);
      setSelectedMarkerIds(new Set());
    };
    window.addEventListener("delete-selected-markers", handler);
    return () => window.removeEventListener("delete-selected-markers", handler);
  }, [markers, selectedMarkerIds]);

  const fadeCursorCurrent = useRef<"in" | "out">("in");

  const setGlobalFadeCursor = useCallback((type: "in" | "out") => {
    if (fadeCursorCurrent.current === type) return;
    fadeCursorCurrent.current = type;
    const svg = type === "out"
      ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpolygon points='1,1 1,15 15,15' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 8 15, pointer`
      : `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpolygon points='1,15 15,15 15,1' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 8 15, pointer`;
    document.documentElement.style.setProperty("--fade-cursor", svg);
  }, []);

  useEffect(() => {
    if (!fadeMode) {
      document.documentElement.classList.remove("fade-cursor-active");
      return;
    }
    fadeCursorCurrent.current = "in";
    document.documentElement.style.setProperty("--fade-cursor",
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpolygon points='1,15 15,15 15,1' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 8 15, pointer`
    );
    document.documentElement.classList.add("fade-cursor-active");
    return () => {
      document.documentElement.classList.remove("fade-cursor-active");
    };
  }, [fadeMode]);

  const [zoomKeyA, setZoomKeyA] = useState(false);
  const [zoomKeyD, setZoomKeyD] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const { key, pressed } = (e as CustomEvent).detail;
      if (key === "a") setZoomKeyA(pressed);
      if (key === "d") setZoomKeyD(pressed);
    };
    window.addEventListener("zoom-key", handler);
    return () => window.removeEventListener("zoom-key", handler);
  }, []);

  const playheadTlRef = useRef<HTMLDivElement>(null);
  const recLiveBlockRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [bpmLoading, setBpmLoading] = useState(false);
  const [bpmEditing, setBpmEditing] = useState(false);
  const [bpmEditValue, setBpmEditValue] = useState("");
  const [tapMode, setTapMode] = useState(false);
  const tapTimesRef = useRef<number[]>([]);
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const [tapLocked, setTapLocked] = useState(false);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatDotsRef = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  const beatAnimRef = useRef<number | null>(null);
  const [gridOffset, setGridOffset] = useState(savedGridOffset ?? 0);
  const gridOffsetRef = useRef(gridOffset);
  gridOffsetRef.current = gridOffset;
  (window as any).__telopGridOffset = gridOffset;

  useEffect(() => {
    if (savedGridOffset !== undefined && savedGridOffset !== null) {
      setGridOffset(savedGridOffset);
    }
  }, [savedGridOffset]);

  useEffect(() => {
    if (waveformPeaks && waveformPeaks.length > 0 && duration > 0 && onWaveformEndDetected) {
      const peaksPerSecond = waveformPeaks.length / duration;
      const endTime = detectWaveformEnd(waveformPeaks, peaksPerSecond, duration);
      onWaveformEndDetected(endTime);
    }
  }, [waveformPeaks, duration, onWaveformEndDetected]);

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [quantizeDiv, setQuantizeDiv] = useState<2 | 4>(2);
  const quantizeDivRef = useRef<2 | 4>(2);
  quantizeDivRef.current = quantizeDiv;
  (window as any).__telopQuantizeDiv = quantizeDiv;
  const [localOverrides, setLocalOverrides] = useState<Map<string, { startTime: number; endTime: number }>>(new Map());
  const localOverridesRef = useRef(localOverrides);
  localOverridesRef.current = localOverrides;
  const isDraggingRef = useRef(false);
  const [isSeekDragging, setIsSeekDragging] = useState(false);
  const isSeekDraggingRef = useRef(false);
  isSeekDraggingRef.current = isSeekDragging;
  const rulerDraggingRef = useRef(false);
  const [isGridDragging, setIsGridDragging] = useState(false);
  const gridDragStartX = useRef(0);
  const gridDragOrigOffset = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);
  const [dropPreviewX, setDropPreviewX] = useState<number | null>(null);
  const [creditDrag, setCreditDrag] = useState<{ edge: "in" | "out"; origTime: number } | null>(null);
  const creditDragStartX = useRef(0);
  const creditDragMoved = useRef(false);
  const dragRafId = useRef<number | null>(null);
  const onCreditTimingChangeRef = useRef(onCreditTimingChange);
  onCreditTimingChangeRef.current = onCreditTimingChange;
  const creditInTimeRef = useRef(creditInTime);
  creditInTimeRef.current = creditInTime;
  const creditOutTimeRef = useRef(creditOutTime);
  creditOutTimeRef.current = creditOutTime;
  const [rubberBand, setRubberBand] = useState<{ startX: number; currentX: number } | null>(null);
  const isRubberBanding = useRef(false);
  const rubberBandStartX = useRef(0);
  const undoStackRef = useRef<{ id: string; startTime: number | null; endTime: number | null }[][]>([]);
  const dragLineId = useRef<string | null>(null);
  const dragEdge = useRef<"start" | "end" | "move" | null>(null);
  const dragStartX = useRef(0);
  const dragOrigStart = useRef(0);
  const dragOrigEnd = useRef(0);
  const dragOrigPositions = useRef<Map<string, { startTime: number; endTime: number }>>(new Map());
  const dragCurrentPositions = useRef<Map<string, { startTime: number; endTime: number }>>(new Map());
  const blockDragRafId = useRef<number | null>(null);
  const pendingBlockOverrides = useRef<Map<string, { startTime: number; endTime: number }> | null>(null);
  const dragLinkedId = useRef<string | null>(null);
  const dragLinkedOrig = useRef<{ startTime: number; endTime: number } | null>(null);
  const onTimingsUpdatedRef = useRef(onTimingsUpdated);
  onTimingsUpdatedRef.current = onTimingsUpdated;
  const onPasteLyricsRef = useRef(onPasteLyrics);
  onPasteLyricsRef.current = onPasteLyrics;

  const pixelsPerSecond = zoom;
  const totalWidth = duration > 0 ? duration * pixelsPerSecond : 1000;

  const timeToPixels = (t: number) => t * pixelsPerSecond;
  const pixelsToTime = (px: number) => px / pixelsPerSecond;

  const getEffectiveTiming = (line: LyricLine) => {
    const override = localOverrides.get(line.id);
    if (override) return override;
    return { startTime: line.startTime || 0, endTime: line.endTime || 0 };
  };

  const [waveformLoading, setWaveformLoading] = useState(false);

  useEffect(() => {
    if (savedBpm !== null && savedBpm !== undefined && savedBpm > 0) {
      setBpm(savedBpm);
      setBpmLoading(false);
    }
  }, [savedBpm]);

  useEffect(() => {
    if (!hasAudio) {
      setWaveformPeaks(null);
      if (!savedBpm) setBpm(null);
      setWaveformLoading(false);
      setBpmLoading(false);
      decodedCache = null;
      return;
    }
    let cancelled = false;
    let activeWorker: Worker | null = null;
    setWaveformLoading(true);
    const needBpmDetection = !savedBpm || savedBpm <= 0;
    if (needBpmDetection) setBpmLoading(true);

    const runFallbackBpm = async () => {
      if (cancelled || !audioUrl) {
        if (!cancelled) setBpmLoading(false);
        return;
      }
      try {
        const bpm = await detectBPM(audioUrl);
        if (!cancelled && needBpmDetection) {
          setBpm(bpm);
        }
        if (!cancelled) setBpmLoading(false);
      } catch {
        if (!cancelled) setBpmLoading(false);
      }
    };

    const analyze = async () => {
      try {
        if (!audioArrayBuffer) {
          setWaveformLoading(false);
          if (needBpmDetection) setBpmLoading(false);
          return;
        }
        const arrayBuffer = audioArrayBuffer;
        if (cancelled) return;

        const isWavBuffer = arrayBuffer.byteLength >= 12 &&
          new DataView(arrayBuffer).getUint32(0, false) === 0x52494646 &&
          new DataView(arrayBuffer).getUint32(8, false) === 0x57415645;

        const computePeaksMainThread = (channelData: Float32Array, sr: number) => {
          const samplesPerPeak = Math.floor(sr / 100);
          const peakCount = Math.ceil(channelData.length / samplesPerPeak);
          const peaks = new Float32Array(peakCount);
          for (let i = 0; i < peakCount; i++) {
            let max = 0;
            const start = i * samplesPerPeak;
            const end = Math.min(start + samplesPerPeak, channelData.length);
            for (let j = start; j < end; j++) {
              const abs = Math.abs(channelData[j]);
              if (abs > max) max = abs;
            }
            peaks[i] = max;
          }
          return peaks;
        };

        const computeFallbackPeaks = (buf: ArrayBuffer, audioDur: number) => {
          const bytes = new Uint8Array(buf);
          const d = audioDur > 0 ? audioDur : 180;
          const peaksCount = Math.ceil(d * 100);
          const bytesPerPeak = Math.max(1, Math.floor(bytes.length / peaksCount));
          const peaks = new Float32Array(peaksCount);
          for (let i = 0; i < peaksCount; i++) {
            const start = i * bytesPerPeak;
            const end = Math.min(start + bytesPerPeak, bytes.length);
            let maxVal = 0;
            for (let j = start; j < end; j++) {
              const v = Math.abs(bytes[j] - 128) / 128;
              if (v > maxVal) maxVal = v;
            }
            peaks[i] = maxVal;
          }
          let maxPeak = 0;
          for (let i = 0; i < peaks.length; i++) if (peaks[i] > maxPeak) maxPeak = peaks[i];
          if (maxPeak > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= maxPeak;
          return peaks;
        };

        if (isWavBuffer) {
          const worker = createAudioWorker();
          if (!worker) {
            const peaks = computeFallbackPeaks(arrayBuffer, duration);
            if (!cancelled) {
              setWaveformPeaks(peaks);
              setWaveformLoading(false);
            }
            runFallbackBpm();
            return;
          }
          activeWorker = worker;
          worker.onmessage = (e: MessageEvent) => {
            if (cancelled) { worker.terminate(); return; }
            if (e.data.type === "peaks") {
              setWaveformPeaks(e.data.peaks);
              setWaveformLoading(false);
              worker.terminate();
              activeWorker = null;
            }
          };
          worker.onerror = (err) => {
            console.warn("Audio worker error (WAV), using fallback:", err?.message || err);
            if (cancelled) { worker.terminate(); return; }
            worker.terminate();
            activeWorker = null;
            const peaks = computeFallbackPeaks(arrayBuffer, duration);
            if (!cancelled) {
              setWaveformPeaks(peaks);
              setWaveformLoading(false);
            }
          };
          const bufferCopy = arrayBuffer.slice(0);
          worker.postMessage(
            { type: "analyzeRaw", rawBuffer: bufferCopy, skipBpm: true },
            [bufferCopy]
          );
          runFallbackBpm();
          return;
        }

        let channelCopy: Float32Array;
        let sampleRate: number;
        try {
          if (decodedCache && decodedCache.projectId === projectId && decodedCache.bufferByteLength === arrayBuffer.byteLength) {
            channelCopy = new Float32Array(decodedCache.channelData.length);
            channelCopy.set(decodedCache.channelData);
            sampleRate = decodedCache.sampleRate;
          } else {
            const tmpCtx = new AudioContext();
            const clonedBuffer = arrayBuffer.slice(0);
            const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
              tmpCtx.decodeAudioData(clonedBuffer, resolve, reject);
            });
            tmpCtx.close().catch(() => {});
            const raw = decoded.getChannelData(0);
            const cachedData = new Float32Array(raw.length);
            cachedData.set(raw);
            sampleRate = decoded.sampleRate;
            decodedCache = { projectId, bufferByteLength: arrayBuffer.byteLength, channelData: cachedData, sampleRate };
            channelCopy = new Float32Array(cachedData.length);
            channelCopy.set(cachedData);
          }
        } catch (decodeErr) {
          console.warn("decodeAudioData failed, using fallback peaks:", decodeErr);
          const bytes = new Uint8Array(arrayBuffer);
          const audioDuration = duration > 0 ? duration : 180;
          const peaksCount = Math.ceil(audioDuration * 100);
          const bytesPerPeak = Math.max(1, Math.floor(bytes.length / peaksCount));
          const peaks = new Float32Array(peaksCount);
          for (let i = 0; i < peaksCount; i++) {
            const start = i * bytesPerPeak;
            const end = Math.min(start + bytesPerPeak, bytes.length);
            let maxVal = 0;
            for (let j = start; j < end; j++) {
              const v = Math.abs(bytes[j] - 128) / 128;
              if (v > maxVal) maxVal = v;
            }
            peaks[i] = maxVal;
          }
          let maxPeak = 0;
          for (let i = 0; i < peaks.length; i++) {
            if (peaks[i] > maxPeak) maxPeak = peaks[i];
          }
          if (maxPeak > 0) {
            for (let i = 0; i < peaks.length; i++) peaks[i] /= maxPeak;
          }
          if (!cancelled) {
            setWaveformPeaks(peaks);
            setWaveformLoading(false);
          }
          runFallbackBpm();
          return;
        }
        if (cancelled) return;

        const worker = createAudioWorker();
        if (!worker) {
          const peaks = computePeaksMainThread(channelCopy, sampleRate);
          if (!cancelled) {
            setWaveformPeaks(peaks);
            setWaveformLoading(false);
          }
          runFallbackBpm();
        } else {
          activeWorker = worker;
          worker.onmessage = (e: MessageEvent) => {
            if (cancelled) { worker.terminate(); return; }
            if (e.data.type === "peaks") {
              setWaveformPeaks(e.data.peaks);
              setWaveformLoading(false);
              worker.terminate();
              activeWorker = null;
            }
          };
          worker.onerror = (err) => {
            console.warn("Audio worker error, using fallback:", err?.message || err);
            if (cancelled) { worker.terminate(); return; }
            worker.terminate();
            activeWorker = null;
            const peaks = computePeaksMainThread(channelCopy, sampleRate);
            if (!cancelled) {
              setWaveformPeaks(peaks);
              setWaveformLoading(false);
            }
          };
          const sendCopy = new Float32Array(channelCopy.length);
          sendCopy.set(channelCopy);
          worker.postMessage(
            { type: "analyze", channelData: sendCopy, sampleRate, skipBpm: true },
            [sendCopy.buffer]
          );
        }

        if (!cancelled) {
          try {
            const bpmResult = detectBPMFromSamples(channelCopy, sampleRate);
            if (!cancelled && needBpmDetection) {
              setBpm(bpmResult);
            }
            if (!cancelled) setBpmLoading(false);
          } catch (bpmErr) {
            console.warn("Main thread BPM detection failed:", bpmErr);
            if (!cancelled) setBpmLoading(false);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn("Audio analysis failed:", err?.message || err);
          setWaveformLoading(false);
          setBpmLoading(false);
        }
      }
    };
    analyze();
    return () => {
      cancelled = true;
      if (activeWorker) { activeWorker.terminate(); activeWorker = null; }
    };
  }, [hasAudio, projectId, audioArrayBuffer]);

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const isRecRef = useRef(isRec);
  isRecRef.current = isRec;
  const recIdxRef = useRef(recIdx);
  recIdxRef.current = recIdx;
  const recordingTimingsRef = useRef(recordingTimings);
  recordingTimingsRef.current = recordingTimings;

  useEffect(() => {
    const dots = beatDotsRef.current;
    if (!bpm || bpm <= 0 || !isPlaying) {
      dots.forEach((d) => { if (d) { d.style.backgroundColor = "hsl(0 0% 22%)"; d.style.boxShadow = "none"; } });
      return;
    }
    const beatInterval = 60 / bpm;
    const hue = aHue;
    let prevBeat = -1;
    const iv = setInterval(() => {
      const ct = audioRef.current ? audioRef.current.currentTime : currentTimeRef.current;
      const offset = gridOffsetRef.current || 0;
      const adjusted = ct - offset;
      const beatNum = adjusted >= 0 ? Math.floor(adjusted / beatInterval) : -1;
      const currentBeatInBar = beatNum >= 0 ? beatNum % 4 : -1;
      if (currentBeatInBar !== prevBeat) {
        for (let i = 0; i < 4; i++) {
          const d = dots[i];
          if (!d) continue;
          if (i === currentBeatInBar) {
            d.style.backgroundColor = i === 0 ? "hsl(0 0% 95%)" : "hsl(0 0% 65%)";
            d.style.boxShadow = i === 0 ? "0 0 6px hsla(0, 0%, 95%, 0.6)" : "0 0 6px hsla(0, 0%, 65%, 0.6)";
          } else {
            d.style.backgroundColor = "hsl(0 0% 22%)";
            d.style.boxShadow = "none";
          }
        }
        prevBeat = currentBeatInBar;
      }
    }, 4);
    return () => clearInterval(iv);
  }, [bpm, isPlaying, aHue]);

  useEffect(() => {
    const liveEl = recLiveBlockRef.current;
    if (!liveEl) return;
    if (isRec && recordingTimings && recIdx !== undefined && recIdx >= 0 && recIdx < recordingTimings.length) {
      const entry = recordingTimings[recIdx];
      if (entry && entry.startTime !== null && entry.endTime === null) {
        const ct = currentTimeRef.current;
        const left = entry.startTime * pixelsPerSecond;
        const width = Math.max((ct - entry.startTime) * pixelsPerSecond, 4);
        liveEl.style.left = `${left}px`;
        liveEl.style.width = `${width}px`;
        liveEl.style.display = "block";
      } else {
        liveEl.style.display = "none";
      }
    } else {
      liveEl.style.display = "none";
    }
  }, [isRec, recIdx, recordingTimings, pixelsPerSecond]);

  const updateRecLiveBlock = useCallback((liveEl: HTMLDivElement, ct: number, pps: number) => {
    const ri = recIdxRef.current ?? -1;
    const rt = recordingTimingsRef.current;
    const isRecNow = isRecRef.current;
    if (isRecNow && rt && ri >= 0 && ri < rt.length) {
      const entry = rt[ri];
      if (entry && entry.startTime !== null && entry.endTime === null) {
        const left = entry.startTime * pps;
        const width = Math.max((ct - entry.startTime) * pps, 4);
        liveEl.style.left = `${left}px`;
        liveEl.style.width = `${width}px`;
        liveEl.style.display = "block";
      } else {
        liveEl.style.display = "none";
      }
    } else {
      liveEl.style.display = "none";
    }
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    let rafId: number;
    let prevScroll = -1;
    const tick = () => {
      const ct = (isPlayingRef.current && audioRef.current) ? audioRef.current.currentTime : currentTimeRef.current;
      const pps = pixelsPerSecondRef.current;
      const px = ct * pps;
      if (playheadTlRef.current) playheadTlRef.current.style.left = `${px}px`;

      if (isPlayingRef.current && timelineRef.current) {
        const el = timelineRef.current;
        const sinceZoom = Date.now() - zoomScrollSuppressRef.current;
        const target = Math.max(0, px - el.clientWidth / 2);
        if (sinceZoom < 50) {
          el.scrollLeft = target;
          prevScroll = target;
        } else {
          zoomIntendedScrollRef.current = -1;
          if (prevScroll < 0) prevScroll = el.scrollLeft;
          prevScroll += (target - prevScroll) * 0.15;
          el.scrollLeft = prevScroll;
        }
      } else {
        prevScroll = -1;
        zoomIntendedScrollRef.current = -1;
      }

      const liveEl = recLiveBlockRef.current;
      if (liveEl) {
        updateRecLiveBlock(liveEl, ct, pps);
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const dragDidMove = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const sectionBlockDidMove = useRef(false);
  // ダブルクリック追加コールバックの最新版を保持（onDoubleClick 内から参照しやすくするため）
  const onSectionAddAtRef = useRef(onSectionAddAt);
  onSectionAddAtRef.current = onSectionAddAt;

  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("timeline-snap-change", { detail: snapEnabled }));
  }, [snapEnabled]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("timeline-quantize-div-change", { detail: quantizeDiv }));
  }, [quantizeDiv]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("timeline-bpm-change", { detail: bpm }));
  }, [bpm]);

  // 既存の保存済み BPM を無視して、強化アルゴリズム（キック帯域マッチ）で BPM を再検出する
  const redetectBpmNow = useCallback(async () => {
    if (!audioArrayBuffer) return;
    setBpmLoading(true);
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const tmpCtx: AudioContext = new AudioCtx();
      const clonedBuffer = audioArrayBuffer.slice(0);
      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        tmpCtx.decodeAudioData(clonedBuffer, resolve, reject);
      });
      try { tmpCtx.close(); } catch {}
      const raw = decoded.getChannelData(0);
      const channelCopy = new Float32Array(raw.length);
      channelCopy.set(raw);
      const sampleRate = decoded.sampleRate;
      const bpmResult = detectBPMFromSamples(channelCopy, sampleRate);
      if (bpmResult) {
        setBpm(bpmResult);
      }
    } catch (err) {
      console.warn("BPM re-detect failed:", err);
    } finally {
      setBpmLoading(false);
    }
  }, [audioArrayBuffer]);
  const getOtherBlocks = useCallback((excludeIds: Set<string>) => {
    const blocks: { id: string; startTime: number; endTime: number }[] = [];
    for (const line of lyrics) {
      if (excludeIds.has(line.id)) continue;
      if (line.startTime === null || line.endTime === null) continue;
      if (!line.text || line.text.trim() === "") continue;
      const ov = localOverridesRef.current.get(line.id);
      const s = ov ? ov.startTime : line.startTime;
      const e = ov ? ov.endTime : line.endTime;
      blocks.push({ id: line.id, startTime: s, endTime: e });
    }
    return blocks;
  }, [lyrics]);

  const clampToNoOverlap = useCallback((start: number, end: number, excludeIds: Set<string>): { start: number; end: number } => {
    const others = getOtherBlocks(excludeIds);
    let s = start, e = end;
    for (const o of others) {
      if (s < o.endTime && e > o.startTime) {
        const overlapLeft = o.endTime - s;
        const overlapRight = e - o.startTime;
        if (overlapLeft < overlapRight) {
          s = o.endTime;
          e = s + (end - start);
        } else {
          e = o.startTime;
          s = e - (end - start);
        }
      }
    }
    return { start: Math.max(0, s), end: e };
  }, [getOtherBlocks]);

  const clampEdgeNoOverlap = useCallback((time: number, lineId: string, edge: "start" | "end", excludeLinked?: boolean): number => {
    const exclude = new Set([lineId]);
    const linkedId = dragLinkedId.current;
    if (linkedId && excludeLinked) exclude.add(linkedId);
    const others = getOtherBlocks(exclude);
    let result = time;
    for (const o of others) {
      if (edge === "end" && result > o.startTime && dragOrigStart.current < o.startTime) {
        result = Math.min(result, o.startTime);
      }
      if (edge === "start" && result < o.endTime && dragOrigEnd.current > o.endTime) {
        result = Math.max(result, o.endTime);
      }
    }
    return result;
  }, [getOtherBlocks]);

  const snapToBeat = useCallback((time: number, forceSnap?: boolean): number => {
    const currentBpm = bpmRef.current;
    if (!currentBpm || currentBpm <= 0) return time;
    if (!forceSnap && !snapEnabledRef.current) return time;
    const snapInterval = 60 / currentBpm / quantizeDivRef.current;
    const offset = gridOffsetRef.current;
    const relativeTime = time - offset;
    const nearestBeat = Math.round(relativeTime / snapInterval) * snapInterval + offset;
    return Math.max(0, nearestBeat);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, lineId: string, edge: "start" | "end" | "move") => {
      e.stopPropagation();
      e.preventDefault();
      const line = lyrics.find((l) => l.id === lineId);
      if (!line || line.startTime === null || line.endTime === null) return;
      const override = localOverridesRef.current.get(line.id);
      const t = override || { startTime: line.startTime || 0, endTime: line.endTime || 0 };
      dragDidMove.current = false;
      isDraggingRef.current = true;
      dragLineId.current = lineId;
      dragEdge.current = edge;
      dragStartX.current = e.clientX;
      dragOrigStart.current = t.startTime;
      dragOrigEnd.current = t.endTime;

      const origPos = new Map<string, { startTime: number; endTime: number }>();
      origPos.set(lineId, { startTime: t.startTime, endTime: t.endTime });
      if (edge === "move" && selectedIdsRef.current.has(lineId)) {
        for (const sid of selectedIdsRef.current) {
          if (sid === lineId) continue;
          const sl = lyrics.find((l) => l.id === sid);
          if (sl && sl.startTime !== null && sl.endTime !== null) {
            const sOverride = localOverridesRef.current.get(sl.id);
            const st = sOverride || { startTime: sl.startTime || 0, endTime: sl.endTime || 0 };
            origPos.set(sid, { startTime: st.startTime, endTime: st.endTime });
          }
        }
      }
      dragOrigPositions.current = origPos;

      dragLinkedId.current = null;
      dragLinkedOrig.current = null;
      const isSelected = selectedIdsRef.current.has(lineId);
      if (!isSelected && (edge === "end" || edge === "start")) {
        const threshold = 0.01;
        for (const other of lyrics) {
          if (other.id === lineId || other.startTime === null || other.endTime === null) continue;
          const ot = localOverridesRef.current.get(other.id) || { startTime: other.startTime, endTime: other.endTime };
          if (edge === "end" && Math.abs(ot.startTime - t.endTime) < threshold) {
            dragLinkedId.current = other.id;
            dragLinkedOrig.current = { startTime: ot.startTime, endTime: ot.endTime };
            origPos.set(other.id, { startTime: ot.startTime, endTime: ot.endTime });
            break;
          }
          if (edge === "start" && Math.abs(ot.endTime - t.startTime) < threshold) {
            dragLinkedId.current = other.id;
            dragLinkedOrig.current = { startTime: ot.startTime, endTime: ot.endTime };
            origPos.set(other.id, { startTime: ot.startTime, endTime: ot.endTime });
            break;
          }
        }
      }

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartX.current;
        if (!dragDidMove.current && Math.abs(dx) < 3) return;
        dragDidMove.current = true;
        const pps = pixelsPerSecondRef.current;
        const dt = dx / pps;
        const curEdge = dragEdge.current!;
        const curLineId = dragLineId.current!;
        const curDuration = durationRef.current;

        if (curEdge === "move" && dragOrigPositions.current.size > 1) {
          const primaryOrig = dragOrigPositions.current.get(curLineId)!;
          let rawStart = primaryOrig.startTime + dt;
          rawStart = snapToBeat(rawStart);
          const actualDt = rawStart - primaryOrig.startTime;

          const currentPos = new Map(dragCurrentPositions.current);
          const pendingNext = new Map(pendingBlockOverrides.current ?? localOverridesRef.current);
          for (const [sid, orig] of dragOrigPositions.current) {
            const ns = Math.max(0, orig.startTime + actualDt);
            const ne = Math.max(0.05, orig.endTime + actualDt);
            pendingNext.set(sid, { startTime: ns, endTime: ne });
            currentPos.set(sid, { startTime: ns, endTime: ne });
          }
          pendingBlockOverrides.current = pendingNext;
          dragCurrentPositions.current = currentPos;
          if (blockDragRafId.current != null) cancelAnimationFrame(blockDragRafId.current);
          blockDragRafId.current = requestAnimationFrame(() => {
            blockDragRafId.current = null;
            if (pendingBlockOverrides.current) {
              setLocalOverrides(pendingBlockOverrides.current);
            }
          });
        } else {
          let newStart = dragOrigStart.current;
          let newEnd = dragOrigEnd.current;

          const breakLinked = ev.metaKey || ev.ctrlKey;
          const linkedId = dragLinkedId.current;
          const linkedOrig = dragLinkedOrig.current;
          let linkedNewStart = linkedOrig?.startTime ?? 0;
          let linkedNewEnd = linkedOrig?.endTime ?? 0;
          let modifyLinkedInstead = false;

          if (breakLinked && linkedId && linkedOrig && curEdge !== "move") {
            if (curEdge === "end" && dt > 0) {
              modifyLinkedInstead = true;
              let rawLinkedStart = linkedOrig.startTime + dt;
              rawLinkedStart = snapToBeat(rawLinkedStart);
              if (rawLinkedStart >= linkedOrig.endTime - 0.05) rawLinkedStart = linkedOrig.endTime - 0.05;
              rawLinkedStart = clampEdgeNoOverlap(rawLinkedStart, linkedId, "start", false);
              linkedNewStart = rawLinkedStart;
            } else if (curEdge === "start" && dt < 0) {
              modifyLinkedInstead = true;
              let rawLinkedEnd = linkedOrig.endTime + dt;
              rawLinkedEnd = snapToBeat(rawLinkedEnd);
              if (rawLinkedEnd <= linkedOrig.startTime + 0.05) rawLinkedEnd = linkedOrig.startTime + 0.05;
              rawLinkedEnd = clampEdgeNoOverlap(rawLinkedEnd, linkedId, "end", false);
              linkedNewEnd = rawLinkedEnd;
            }
          }

          if (!modifyLinkedInstead) {
            if (curEdge === "move") {
              const dur = dragOrigEnd.current - dragOrigStart.current;
              let rawStart = dragOrigStart.current + dt;
              rawStart = snapToBeat(rawStart);
              rawStart = Math.max(0, rawStart);
              if (rawStart + dur > curDuration) rawStart = Math.max(0, curDuration - dur);
              const excludeIds = new Set<string>();
              for (const sid of dragOrigPositions.current.keys()) excludeIds.add(sid);
              const clamped = clampToNoOverlap(rawStart, rawStart + dur, excludeIds);
              rawStart = clamped.start;
              newStart = rawStart;
              newEnd = rawStart + (dragOrigEnd.current - dragOrigStart.current);
            } else if (curEdge === "start") {
              let rawStart = dragOrigStart.current + dt;
              rawStart = snapToBeat(rawStart);
              rawStart = Math.max(0, rawStart);
              if (rawStart >= newEnd - 0.05) rawStart = newEnd - 0.05;
              if (!breakLinked && linkedId && linkedOrig) {
                if (rawStart <= linkedOrig.startTime + 0.05) rawStart = linkedOrig.startTime + 0.05;
              }
              rawStart = clampEdgeNoOverlap(rawStart, curLineId, "start", !breakLinked);
              newStart = rawStart;
            } else {
              let rawEnd = dragOrigEnd.current + dt;
              rawEnd = snapToBeat(rawEnd);
              rawEnd = Math.min(curDuration, rawEnd);
              if (rawEnd <= newStart + 0.05) rawEnd = newStart + 0.05;
              if (!breakLinked && linkedId && linkedOrig) {
                if (rawEnd >= linkedOrig.endTime - 0.05) rawEnd = linkedOrig.endTime - 0.05;
              }
              rawEnd = clampEdgeNoOverlap(rawEnd, curLineId, "end", !breakLinked);
              newEnd = rawEnd;
            }
          }

          const useLinked = !breakLinked && linkedId && linkedOrig;
          const pendingNext2 = new Map(pendingBlockOverrides.current ?? localOverridesRef.current);
          pendingNext2.set(curLineId, { startTime: newStart, endTime: newEnd });
          if (modifyLinkedInstead && linkedId && linkedOrig) {
            pendingNext2.set(linkedId, { startTime: linkedNewStart, endTime: linkedNewEnd });
            dragCurrentPositions.current.set(linkedId, { startTime: linkedNewStart, endTime: linkedNewEnd });
          } else if (useLinked && linkedId && linkedOrig) {
            if (curEdge === "end") {
              pendingNext2.set(linkedId, { startTime: newEnd, endTime: linkedOrig.endTime });
              dragCurrentPositions.current.set(linkedId, { startTime: newEnd, endTime: linkedOrig.endTime });
            } else if (curEdge === "start") {
              pendingNext2.set(linkedId, { startTime: linkedOrig.startTime, endTime: newStart });
              dragCurrentPositions.current.set(linkedId, { startTime: linkedOrig.startTime, endTime: newStart });
            }
          }
          pendingBlockOverrides.current = pendingNext2;
          dragCurrentPositions.current.set(curLineId, { startTime: newStart, endTime: newEnd });
          if (blockDragRafId.current != null) cancelAnimationFrame(blockDragRafId.current);
          blockDragRafId.current = requestAnimationFrame(() => {
            blockDragRafId.current = null;
            if (pendingBlockOverrides.current) {
              setLocalOverrides(pendingBlockOverrides.current);
            }
          });
        }
      };

      const cleanup = () => {
        if (blockDragRafId.current != null) { cancelAnimationFrame(blockDragRafId.current); blockDragRafId.current = null; }
        pendingBlockOverrides.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        dragCleanupRef.current = null;
      };

      const onMouseUp = async () => {
        cleanup();

        if (dragDidMove.current) {
          const updates: { id: string; startTime: number; endTime: number }[] = [];
          const undoEntries: { id: string; startTime: number | null; endTime: number | null }[] = [];

          for (const [sid, orig] of dragOrigPositions.current) {
            const current = dragCurrentPositions.current.get(sid);
            if (current) {
              updates.push({ id: sid, startTime: current.startTime, endTime: current.endTime });
              undoEntries.push({ id: sid, startTime: orig.startTime, endTime: orig.endTime });
            }
          }

          if (undoEntries.length > 0) {
            undoStackRef.current.push(undoEntries);
            if (undoStackRef.current.length > 50) undoStackRef.current.shift();
          }
          if (updates.length > 0) {
            await onTimingsUpdatedRef.current(updates);
          }
        }

        isDraggingRef.current = false;
        dragLineId.current = null;
        dragEdge.current = null;
        dragLinkedId.current = null;
        dragLinkedOrig.current = null;
        dragOrigPositions.current = new Map();
        dragCurrentPositions.current = new Map();
      };

      if (dragCleanupRef.current) dragCleanupRef.current();
      dragCleanupRef.current = cleanup;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [lyrics, snapToBeat]
  );

  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        isDraggingRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setLocalOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [lineId, override] of Array.from(prev.entries())) {
        const line = lyrics.find((l) => l.id === lineId);
        if (!line) { next.delete(lineId); changed = true; continue; }
        const parentStart = line.startTime ?? 0;
        const parentEnd = line.endTime ?? 0;
        if (Math.abs(parentStart - override.startTime) < 0.01 && Math.abs(parentEnd - override.endTime) < 0.01) {
          next.delete(lineId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [lyrics]);

  const seekFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const tRef = timelineRef.current;
    if (!tRef) return;
    const rect = tRef.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const edgeZone = 40;
    const maxEdgeSpeed = 8;
    if (relX < edgeZone) {
      const ratio = Math.max(0, (edgeZone - relX) / edgeZone);
      const speed = 1 + ratio * (maxEdgeSpeed - 1);
      tRef.scrollLeft = Math.max(0, tRef.scrollLeft - speed);
    } else if (relX > rect.width - edgeZone) {
      const ratio = Math.max(0, (relX - (rect.width - edgeZone)) / edgeZone);
      const speed = 1 + ratio * (maxEdgeSpeed - 1);
      tRef.scrollLeft = tRef.scrollLeft + speed;
    }
    const scrollLeft = tRef.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft;
    const t = Math.max(0, Math.min(duration, pixelsToTime(x)));
    seekTo(t);
  }, [duration, pixelsPerSecond, seekTo]);

  useEffect(() => {
    if (!isSeekDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      seekFromEvent(e);
    };
    const onMouseUp = () => {
      setIsSeekDragging(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isSeekDragging, seekFromEvent]);

  useEffect(() => {
    if (!isGridDragging) return;
    let latestOffset = gridOffsetRef.current;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - gridDragStartX.current;
      const dtSec = dx / pixelsPerSecond;
      latestOffset = gridDragOrigOffset.current + dtSec;
      setGridOffset(latestOffset);
    };
    const onMouseUp = () => {
      setIsGridDragging(false);
      onBpmGridOffsetChange?.(latestOffset);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isGridDragging, pixelsPerSecond, onBpmGridOffsetChange]);

  const DEFAULT_CREDIT_ANIM_MS = 6700;
  const [localCreditIn, setLocalCreditIn] = useState<number | null>(null);
  const [localCreditOut, setLocalCreditOut] = useState<number | null>(null);
  const effectiveCreditIn = localCreditIn !== null ? localCreditIn : (creditInTime ?? null);
  const effectiveCreditOut = localCreditOut !== null ? localCreditOut : (creditOutTime ?? null);
  const rawCreditAnimDur = creditAnimDuration ?? DEFAULT_CREDIT_ANIM_MS;
  const rtAnimMs = rightTitleAnimDurMs ?? 0;
  const effectiveCreditAnimDur = rawCreditAnimDur;
  // 右タイトル文字アニメの素の値（preset と統一）。preview 側と同じ値を使うことで、
  // TITLE B 帯の終端 = アニメ完了タイミングが一致するようにする。
  const RT_CHAR_DELAY_BASE = 100;
  const RT_CHAR_ANIM_DUR_BASE = 500;
  const calcBarEndMs = useCallback((animDur: number, wipeMs: number) => {
    const wipeDurMs = Math.round(animDur * 0.5);
    const animScale = animDur / DEFAULT_CREDIT_ANIM_MS;
    const rtLen = (rightTitleText ?? "").trim().length;
    const rtCharDelay = RT_CHAR_DELAY_BASE * animScale;
    const rtCharAnimDur = RT_CHAR_ANIM_DUR_BASE * animScale;
    const rtTotalDur = rtLen > 0 ? ((rtLen - 1) * rtCharDelay + rtCharAnimDur + 500) : 0;
    return wipeMs + wipeDurMs + rtTotalDur;
  }, [rightTitleText]);
  const [localAnimDur, setLocalAnimDur] = useState<number | null>(null);
  const [isAnimDurDrag, setIsAnimDurDrag] = useState(false);
  const animDurDragStartX = useRef(0);
  const animDurDragOrigDur = useRef(0);
  const onCreditAnimDurationChangeRef = useRef(onCreditAnimDurationChange);
  onCreditAnimDurationChangeRef.current = onCreditAnimDurationChange;

  const bpmForBarDefaults = savedBpm || 120;
  const barMsForDefaults = (60 / bpmForBarDefaults) * 4000;
  const defaultWipeStartMsVal = Math.round(barMsForDefaults * 3);
  const effectiveWipeStartMs = creditWipeStartMs ?? defaultWipeStartMsVal;
  const [localWipeStartMs, setLocalWipeStartMs] = useState<number | null>(null);
  const [isWipeStartDrag, setIsWipeStartDrag] = useState(false);
  const wipeStartDragStartX = useRef(0);
  const wipeStartDragOrigMs = useRef(0);
  const wipeStartDragOrigAnimDur = useRef(0);
  const onCreditWipeStartMsChangeRef = useRef(onCreditWipeStartMsChange);
  onCreditWipeStartMsChangeRef.current = onCreditWipeStartMsChange;
  const onWipeStartWithDurationChangeRef = useRef(onWipeStartWithDurationChange);
  onWipeStartWithDurationChangeRef.current = onWipeStartWithDurationChange;
  const effectiveHoldStartMs = (() => {
    const wipeMs = creditWipeStartMs ?? defaultWipeStartMsVal;
    if (creditHoldStartMs != null) {
      return Math.max(500, Math.min(creditHoldStartMs, wipeMs - 500));
    }
    return Math.round(barMsForDefaults * 2);
  })();
  const [localHoldStartMs, setLocalHoldStartMs] = useState<number | null>(null);
  const latestLocalHoldStartMs = useRef<number | null>(null);
  const [isHoldStartDrag, setIsHoldStartDrag] = useState(false);
  const holdStartDragStartX = useRef(0);
  const holdStartDragOrigMs = useRef(0);
  const holdStartDragOrigWipeMs = useRef(0);
  const holdStartDragOrigAnimDur = useRef(0);
  const onCreditHoldStartMsChangeRef = useRef(onCreditHoldStartMsChange);
  onCreditHoldStartMsChangeRef.current = onCreditHoldStartMsChange;
  const onHoldStartWithWipeAndDurationChangeRef = useRef(onHoldStartWithWipeAndDurationChange);
  onHoldStartWithWipeAndDurationChangeRef.current = onHoldStartWithWipeAndDurationChange;

  const onCreditDeleteRef = useRef(onCreditDelete);
  onCreditDeleteRef.current = onCreditDelete;

  const [creditBarSelected, setCreditBarSelected] = useState(false);
  const creditBarSelectedRef = useRef(false);
  creditBarSelectedRef.current = creditBarSelected;

  useEffect(() => {
    setLocalCreditIn(prev => prev !== null && creditInTime != null && Math.abs(prev - creditInTime) < 0.01 ? null : prev);
  }, [creditInTime]);
  useEffect(() => {
    setLocalCreditOut(prev => prev !== null && creditOutTime != null && Math.abs(prev - creditOutTime) < 0.01 ? null : prev);
  }, [creditOutTime]);

  const [creditDragPreviewX, setCreditDragPreviewX] = useState<number | null>(null);

  useEffect(() => {
    if (!creditDragActive) {
      setCreditDragPreviewX(null);
      return;
    }
    const onMouseMove = (e: MouseEvent) => {
      const tlEl = timelineRef.current;
      if (!tlEl) return;
      const rect = tlEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const scrollLeft = tlEl.scrollLeft;
        const x = e.clientX - rect.left + scrollLeft;
        let t = Math.max(0, Math.min(duration > 0 ? duration : Infinity, pixelsToTime(x)));
        t = snapToBeat(t);
        setCreditDragPreviewX(t * pixelsPerSecond);
      } else {
        setCreditDragPreviewX(null);
      }
    };
    const onMouseUp = () => {
      setCreditDragPreviewX(null);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [creditDragActive, duration, pixelsPerSecond, snapToBeat]);

  const latestLocalCreditIn = useRef<number | null>(null);
  const latestLocalCreditOut = useRef<number | null>(null);
  const latestLocalAnimDur = useRef<number | null>(null);
  const latestLocalWipeStartMs = useRef<number | null>(null);
  useEffect(() => { latestLocalCreditIn.current = localCreditIn; }, [localCreditIn]);
  useEffect(() => { latestLocalCreditOut.current = localCreditOut; }, [localCreditOut]);
  useEffect(() => { latestLocalAnimDur.current = localAnimDur; }, [localAnimDur]);
  useEffect(() => { latestLocalWipeStartMs.current = localWipeStartMs; }, [localWipeStartMs]);

  useEffect(() => {
    if (!creditDrag) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    const edge = creditDrag.edge;
    const origTime = creditDrag.origTime;
    const dur = duration;
    const pps = pixelsPerSecond;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - creditDragStartX.current;
      if (Math.abs(dx) > 3) creditDragMoved.current = true;
      const dt = dx / pps;
      let rawTime = Math.max(0, Math.min(dur, origTime + dt));
      let newTime = snapToBeat(rawTime);
      newTime = Math.max(0, Math.min(dur, newTime));
      if (edge === "in") {
        const outT = latestLocalCreditOut.current !== null ? latestLocalCreditOut.current : (creditOutTimeRef.current ?? dur);
        if (newTime >= outT) newTime = Math.max(0, outT - 0.1);
        latestLocalCreditIn.current = newTime;
      } else {
        const inT = latestLocalCreditIn.current !== null ? latestLocalCreditIn.current : (creditInTimeRef.current ?? 0);
        if (newTime <= inT) newTime = Math.min(dur, inT + 0.1);
        latestLocalCreditOut.current = newTime;
      }
      if (dragRafId.current != null) cancelAnimationFrame(dragRafId.current);
      dragRafId.current = requestAnimationFrame(() => {
        dragRafId.current = null;
        if (edge === "in") {
          setLocalCreditIn(latestLocalCreditIn.current);
        } else {
          setLocalCreditOut(latestLocalCreditOut.current);
        }
      });
    };
    const onMouseUp = () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      document.body.style.cursor = prevCursor;
      const currentCreditIn = creditInTimeRef.current;
      const currentCreditOut = creditOutTimeRef.current;
      const inT = latestLocalCreditIn.current !== null ? latestLocalCreditIn.current : (currentCreditIn ?? null);
      const outT = latestLocalCreditOut.current !== null ? latestLocalCreditOut.current : (currentCreditOut ?? null);
      
      // Call parent update before clearing local state to prevent flicker
      onCreditTimingChangeRef.current?.(inT, outT);
      
      setCreditDrag(null);
      setLocalCreditIn(null);
      setLocalCreditOut(null);
      latestLocalCreditIn.current = null;
      latestLocalCreditOut.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [creditDrag]);

  useEffect(() => {
    if (!isAnimDurDrag) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    const creditIn = effectiveCreditIn ?? 0;
    const pps = pixelsPerSecond;
    const dur = duration;
    const origAnimDur = animDurDragOrigDur.current;
    const origWipeMs = latestLocalWipeStartMs.current ?? effectiveWipeStartMs;
    const origBarEndMs = calcBarEndMs(origAnimDur, origWipeMs);
    const rtLen = (rightTitleText ?? "").trim().length;
    // K：barEnd の変化量から animDur の変化量を逆算するための係数。
    // calcBarEndMs と同じ素の値を使うことで preview とズレない。
    const K = rtLen > 0 ? (0.5 + ((rtLen - 1) * RT_CHAR_DELAY_BASE + RT_CHAR_ANIM_DUR_BASE) / DEFAULT_CREDIT_ANIM_MS) : 0.5;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - animDurDragStartX.current;
      const dtMs = (dx / pps) * 1000;
      const newBarEndMs = origBarEndMs + dtMs;
      const barEndSec = creditIn + newBarEndMs / 1000;
      const snappedBarEndSec = snapToBeat(barEndSec);
      const snappedBarEndMs = Math.round((snappedBarEndSec - creditIn) * 1000);
      const rawDur = rtLen > 0
        ? (snappedBarEndMs - origWipeMs - 500) / K
        : (snappedBarEndMs - origWipeMs) / K;
      const maxDur = dur > 0 ? Math.max(2000, (dur - creditIn) * 1000) : 30000;
      const clampedDur = Math.round(Math.max(2000, Math.min(maxDur, rawDur)));
      if (clampedDur === latestLocalAnimDur.current) return;
      latestLocalAnimDur.current = clampedDur;
      if (dragRafId.current != null) cancelAnimationFrame(dragRafId.current);
      dragRafId.current = requestAnimationFrame(() => {
        dragRafId.current = null;
        setLocalAnimDur(latestLocalAnimDur.current);
      });
    };
    const onMouseUp = () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      document.body.style.cursor = prevCursor;
      const rawDur = latestLocalAnimDur.current ?? effectiveCreditAnimDur;
      const barEndMs = calcBarEndMs(rawDur, origWipeMs);
      const barEndSec = creditIn + barEndMs / 1000;
      const snappedBarEnd = snapToBeat(barEndSec);
      const snappedBarEndMs = Math.round((snappedBarEnd - creditIn) * 1000);
      const snappedAnimDur = rtLen > 0
        ? (snappedBarEndMs - origWipeMs - 500) / K
        : (snappedBarEndMs - origWipeMs) / K;
      const maxDur = dur > 0 ? Math.max(2000, (dur - creditIn) * 1000) : 30000;
      const finalDur = Math.max(2000, Math.min(maxDur, Math.round(snappedAnimDur)));
      onCreditAnimDurationChangeRef.current?.(finalDur);
      setIsAnimDurDrag(false);
      setLocalAnimDur(null);
      latestLocalAnimDur.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isAnimDurDrag]);

  useEffect(() => {
    if (!isWipeStartDrag) return;
    const creditIn = effectiveCreditIn ?? 0;
    const pps = pixelsPerSecond;
    const holdMs = latestLocalHoldStartMs.current ?? effectiveHoldStartMs;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - wipeStartDragStartX.current;
      const dtMs = (dx / pps) * 1000;
      const rawMs = wipeStartDragOrigMs.current + dtMs;
      const minMs = Math.max(1000, holdMs + 500);
      const clampedMs = Math.max(minMs, rawMs);
      const endTimeSec = creditIn + clampedMs / 1000;
      const snappedEnd = snapToBeat(endTimeSec);
      const snappedMs = Math.max(minMs, Math.round((snappedEnd - creditIn) * 1000));
      latestLocalWipeStartMs.current = snappedMs;
      if (dragRafId.current != null) cancelAnimationFrame(dragRafId.current);
      dragRafId.current = requestAnimationFrame(() => {
        dragRafId.current = null;
        setLocalWipeStartMs(latestLocalWipeStartMs.current);
      });
    };
    const onMouseUp = () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      const finalWipeMs = latestLocalWipeStartMs.current ?? effectiveWipeStartMs;
      onCreditWipeStartMsChangeRef.current?.(finalWipeMs);
      setIsWipeStartDrag(false);
      setLocalWipeStartMs(null);
      latestLocalWipeStartMs.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isWipeStartDrag]);

  useEffect(() => {
    if (!isHoldStartDrag) return;
    const creditIn = effectiveCreditIn ?? 0;
    const pps = pixelsPerSecond;
    const origHoldMs = holdStartDragOrigMs.current;
    const origWipeMs = holdStartDragOrigWipeMs.current;
    const holdLen = origWipeMs - origHoldMs;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - holdStartDragStartX.current;
      const dtMs = (dx / pps) * 1000;
      const rawMs = origHoldMs + dtMs;
      const minMs = 500;
      const clampedMs = Math.max(minMs, rawMs);
      const endTimeSec = creditIn + clampedMs / 1000;
      const snappedEnd = snapToBeat(endTimeSec);
      const snappedMs = Math.max(minMs, Math.round((snappedEnd - creditIn) * 1000));
      const newWipeMs = snappedMs + holdLen;
      latestLocalHoldStartMs.current = snappedMs;
      latestLocalWipeStartMs.current = newWipeMs;
      if (dragRafId.current != null) cancelAnimationFrame(dragRafId.current);
      dragRafId.current = requestAnimationFrame(() => {
        dragRafId.current = null;
        setLocalHoldStartMs(latestLocalHoldStartMs.current);
        setLocalWipeStartMs(latestLocalWipeStartMs.current);
      });
    };
    const onMouseUp = () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      const finalHoldMs = latestLocalHoldStartMs.current ?? effectiveHoldStartMs;
      const finalWipeMs = finalHoldMs + holdLen;
      if (onHoldStartWithWipeAndDurationChangeRef.current) {
        onHoldStartWithWipeAndDurationChangeRef.current(finalHoldMs, finalWipeMs, rawCreditAnimDur);
      } else {
        onCreditHoldStartMsChangeRef.current?.(finalHoldMs);
        onCreditWipeStartMsChangeRef.current?.(finalWipeMs);
      }
      setIsHoldStartDrag(false);
      setLocalHoldStartMs(null);
      setLocalWipeStartMs(null);
      latestLocalHoldStartMs.current = null;
      latestLocalWipeStartMs.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      if (dragRafId.current != null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isHoldStartDrag]);

  const startRubberBand = useCallback((startX: number, clientX: number) => {
    isRubberBanding.current = false;
    rubberBandStartX.current = startX;
    const startClientX = clientX;
    let didDrag = false;
    setCreditBarSelected(false);

    const onMouseMove = (e: MouseEvent) => {
      const tRef = timelineRef.current;
      if (!tRef) return;
      const dist = Math.abs(e.clientX - startClientX);
      if (!didDrag && dist < 5) return;
      didDrag = true;
      if (!isRubberBanding.current) {
        isRubberBanding.current = true;
        setRubberBand({ startX: rubberBandStartX.current, currentX: rubberBandStartX.current });
        setSelectedIds(new Set());
      }
      const rect = tRef.getBoundingClientRect();
      const x = e.clientX - rect.left + tRef.scrollLeft;
      setRubberBand({ startX: rubberBandStartX.current, currentX: x });
      const minX = Math.min(rubberBandStartX.current, x);
      const maxX = Math.max(rubberBandStartX.current, x);
      const newSelected = new Set<string>();
      for (const line of lyrics) {
        if (line.startTime === null || line.endTime === null) continue;
        const override = localOverridesRef.current.get(line.id);
        const t = override || { startTime: line.startTime, endTime: line.endTime };
        const blockLeft = t.startTime * pixelsPerSecond;
        const blockRight = t.endTime * pixelsPerSecond;
        if (blockRight >= minX && blockLeft <= maxX) {
          newSelected.add(line.id);
        }
      }
      setSelectedIds(newSelected);
    };
    const onMouseUp = () => {
      if (!didDrag) {
        setSelectedIds(new Set());
        const tRef = timelineRef.current;
        if (tRef) {
          const t = Math.max(0, Math.min(duration, pixelsToTime(startX)));
          seekTo(t);
        }
      }
      isRubberBanding.current = false;
      setRubberBand(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [lyrics, pixelsPerSecond, duration, seekTo]);

  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target && (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if ((e.key === "Delete" || e.key === "Backspace") && !inInput) {
        if (creditBarSelectedRef.current) {
          e.preventDefault();
          onCreditDeleteRef.current?.();
          setCreditBarSelected(false);
        } else if (selectedIdsRef.current.size > 0) {
          e.preventDefault();
          const currentLyrics = lyricsRef.current;
          const undoEntries: { id: string; startTime: number | null; endTime: number | null }[] = [];
          const deletes: { id: string; startTime: null; endTime: null }[] = [];
          for (const sid of selectedIdsRef.current) {
            const line = currentLyrics.find((l) => l.id === sid);
            if (line && line.startTime !== null) {
              undoEntries.push({ id: line.id, startTime: line.startTime, endTime: line.endTime });
            }
            deletes.push({ id: sid, startTime: null, endTime: null });
          }
          if (undoEntries.length > 0) {
            undoStackRef.current.push(undoEntries);
            if (undoStackRef.current.length > 50) undoStackRef.current.shift();
          }
          onTimingsUpdatedRef.current(deletes);
          setSelectedIds(new Set());
        }
      }
      if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey) && !e.shiftKey && !inInput) {
        e.preventDefault();
        const entry = undoStackRef.current.pop();
        if (entry) {
          setLocalOverrides(new Map());
          onTimingsUpdatedRef.current(entry);
        }
      }
      if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey) && !inInput) {
        e.preventDefault();
        const allTimed = lyricsRef.current.filter((l) => l.startTime !== null).map((l) => l.id);
        setSelectedIds(new Set(allTimed));
      }
      if ((e.key === "c" || e.key === "C") && (e.metaKey || e.ctrlKey) && !inInput && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        const currentLyrics = lyricsRef.current;
        const selected = currentLyrics
          .filter((l) => selectedIdsRef.current.has(l.id) && l.startTime !== null && l.endTime !== null)
          .sort((a, b) => a.startTime! - b.startTime!);
        if (selected.length === 0) return;
        const baseTime = selected[0].startTime!;
        clipboardBlocks = selected.map((l) => ({
          text: l.text,
          relativeStart: l.startTime! - baseTime,
          relativeEnd: l.endTime! - baseTime,
          fadeIn: l.fadeIn ?? 0,
          fadeOut: l.fadeOut ?? 0,
        }));
      }
      if ((e.key === "v" || e.key === "V") && (e.metaKey || e.ctrlKey) && !inInput && clipboardBlocks.length > 0) {
        e.preventDefault();
        const pasteAt = currentTimeRef.current;
        const currentLyrics = lyricsRef.current;
        const allTimed = currentLyrics.filter((l) => l.startTime !== null && l.endTime !== null);
        const newLines = clipboardBlocks.map((cb) => ({
          text: cb.text,
          startTime: pasteAt + cb.relativeStart,
          endTime: pasteAt + cb.relativeEnd,
          fadeIn: cb.fadeIn,
          fadeOut: cb.fadeOut,
        }));
        let hasOverlap = false;
        for (const nl of newLines) {
          for (const existing of allTimed) {
            if (nl.startTime < existing.endTime! && nl.endTime > existing.startTime!) {
              hasOverlap = true;
              break;
            }
          }
          if (hasOverlap) break;
        }
        if (hasOverlap) return;
        onPasteLyricsRef.current?.(newLines);
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inInput && !e.shiftKey && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        const currentLyrics = lyricsRef.current;
        const currentBpm = bpmRef.current;
        const useEighth = e.metaKey || e.ctrlKey;
        const step = currentBpm && currentBpm > 0 ? (useEighth ? 60 / currentBpm / 2 : 60 / currentBpm) : 0.1;
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const delta = step * dir;
        const selectedSet = selectedIdsRef.current;
        const selectedLines = currentLyrics
          .filter((l) => selectedSet.has(l.id) && l.startTime !== null && l.endTime !== null)
          .sort((a, b) => a.startTime! - b.startTime!);
        if (selectedLines.length === 0) return;
        const nonSelectedTimed = currentLyrics
          .filter((l) => !selectedSet.has(l.id) && l.startTime !== null && l.endTime !== null);
        const checkOrder = dir > 0 ? [...selectedLines].reverse() : selectedLines;
        let blocked = false;
        for (const line of checkOrder) {
          const newStart = line.startTime! + delta;
          const newEnd = line.endTime! + delta;
          if (newStart < 0) { blocked = true; break; }
          for (const other of nonSelectedTimed) {
            if (newStart < other.endTime! && newEnd > other.startTime!) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) return;
        const updates: { id: string; startTime: number | null; endTime: number | null }[] = [];
        const undoEntries: { id: string; startTime: number | null; endTime: number | null }[] = [];
        for (const line of selectedLines) {
          const newStart = line.startTime! + delta;
          const newEnd = line.endTime! + delta;
          undoEntries.push({ id: line.id, startTime: line.startTime, endTime: line.endTime });
          updates.push({ id: line.id, startTime: newStart, endTime: newEnd });
        }
        if (updates.length > 0) {
          undoStackRef.current.push(undoEntries);
          if (undoStackRef.current.length > 50) undoStackRef.current.shift();
          onTimingsUpdatedRef.current(updates);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const tickMarks = useMemo(() => {
    if (duration <= 0) return [];
    const ticks = [];
    let interval = 1;
    if (pixelsPerSecond < 20) interval = 10;
    else if (pixelsPerSecond < 40) interval = 5;
    else if (pixelsPerSecond < 80) interval = 2;

    for (let t = 0; t <= duration; t += interval) {
      ticks.push(
        <div
          key={t}
          className="absolute top-0 h-full border-l border-border/30"
          style={{ left: `${timeToPixels(t)}px` }}
        />
      );
    }
    return ticks;
  }, [duration, pixelsPerSecond]);

  const bpmGridLines = useMemo(() => {
    if (!bpm || bpm <= 0 || duration <= 0) return null;
    const quarterInterval = 60 / bpm;
    const eighthInterval = quarterInterval / 2;
    const sixteenthInterval = quarterInterval / 4;
    const show16th = quantizeDiv === 4;
    const smallestInterval = show16th ? sixteenthInterval : eighthInterval;
    const smallestPixels = smallestInterval * pixelsPerSecond;
    const showSmallest = smallestPixels >= 8;
    const lines = [];
    const stepInterval = showSmallest ? smallestInterval : quarterInterval;
    const firstStep = Math.ceil(-gridOffset / stepInterval);
    const maxT = duration;
    const stepsPerQuarter = show16th ? 4 : 2;
    for (let step = firstStep; ; step++) {
      const t = step * stepInterval + gridOffset;
      if (t > maxT) break;
      const beatIndex = step / stepsPerQuarter;
      const isMeasure = Math.abs(beatIndex % 4) < 0.001;
      const isQuarter = step % stepsPerQuarter === 0;
      const isEighth = show16th ? step % 2 === 0 : true;
      let borderStyle: string;
      if (isMeasure) {
        borderStyle = "1px solid rgba(255, 255, 255, 0.35)";
      } else if (isQuarter) {
        borderStyle = "1px solid rgba(255, 255, 255, 0.15)";
      } else if (!isEighth) {
        borderStyle = "1px dotted rgba(255, 255, 255, 0.06)";
      } else {
        borderStyle = "1px dashed rgba(255, 255, 255, 0.08)";
      }
      lines.push(
        <div
          key={`beat-${step}`}
          className="absolute top-0 h-full"
          style={{
            left: `${timeToPixels(t)}px`,
            borderLeft: borderStyle,
          }}
        />
      );
    }
    return <div className="absolute inset-0 pointer-events-none">{lines}</div>;
  }, [bpm, duration, pixelsPerSecond, gridOffset, quantizeDiv]);

  const handleBlockSelect = useCallback((e: React.MouseEvent, lineId: string, lineIndex: number) => {
    e.stopPropagation();
    if (document.activeElement && (document.activeElement as HTMLElement).blur) {
      (document.activeElement as HTMLElement).blur();
    }
    setCreditBarSelected(false);
    if (e.shiftKey) {
      const timedIndices = lyrics.map((l, i) => l.startTime !== null ? i : -1).filter((i) => i >= 0);
      const currentSelected = Array.from(selectedIds);
      const lastSelectedIdx = currentSelected.length > 0
        ? Math.max(...currentSelected.map((sid) => lyrics.findIndex((l) => l.id === sid)))
        : -1;
      const fromIdx = lastSelectedIdx >= 0 ? lastSelectedIdx : lineIndex;
      const minIdx = Math.min(fromIdx, lineIndex);
      const maxIdx = Math.max(fromIdx, lineIndex);
      const rangeIds = new Set(selectedIds);
      for (let i = minIdx; i <= maxIdx; i++) {
        if (lyrics[i].startTime !== null) rangeIds.add(lyrics[i].id);
      }
      setSelectedIds(rangeIds);
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(lineId)) next.delete(lineId);
        else next.add(lineId);
        return next;
      });
    } else {
      setSelectedIds(new Set([lineId]));
    }
  }, [lyrics, selectedIds]);

  const LANE_HEIGHT = 40;
  const LANE_GAP = 2;
  const SECTION_BAND_H = 44;

  const timedEntries = useMemo(() => {
    const srcLyrics = displayLyrics;
    const entries: { line: LyricLine; index: number; startTime: number; endTime: number }[] = [];
    for (let i = 0; i < srcLyrics.length; i++) {
      const line = srcLyrics[i];
      if (isRec && recordingTimings) {
        const rt = recordingTimings.find((r) => r.id === line.id);
        if (rt && rt.startTime !== null && (rt.endTime === null || rt.endTime === undefined)) continue;
      }
      const override = localOverrides.get(line.id);
      const t = override || { startTime: line.startTime || 0, endTime: line.endTime || 0 };
      if (line.startTime === null && line.endTime === null && !override) continue;
      if (!line.text || line.text.trim() === "") continue;
      const effectiveEnd = t.endTime || (isRec ? t.startTime + 0.5 : 0);
      entries.push({ line, index: i, startTime: t.startTime, endTime: effectiveEnd });
    }
    return entries;
  }, [displayLyrics, localOverrides, isRec, recordingTimings]);

  const timelineBlocks = useMemo(() => {
    if (timedEntries.length === 0) return null;

    const sorted = [...timedEntries].sort((a, b) => a.startTime - b.startTime);
    const colorMap = new Map<string, number>();
    sorted.forEach((entry, i) => { colorMap.set(entry.line.id, i % COLORS.length); });

    return timedEntries.map(({ line, index, startTime, endTime }) => {
      const left = startTime * pixelsPerSecond;
      const width = (endTime - startTime) * pixelsPerSecond;
      const dynamicColors = [...COLORS];
      dynamicColors[0] = COLORS[0];
      const color = dynamicColors[colorMap.get(line.id) ?? (index % dynamicColors.length)];
      const isSelected = selectedIds.has(line.id);
      const blockDur = endTime - startTime;
      const fi = line.fadeIn ?? 0;
      const fo = line.fadeOut ?? 0;

      const fadeInCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpolygon points='1,15 15,15 15,1' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 8 15, pointer`;
      const fadeOutCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpolygon points='1,1 1,15 15,15' fill='white' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 8 15, pointer`;

      return (
        <div
          key={line.id}
          className="absolute flex items-center group"
          style={{
            left: `${left}px`,
            width: `${Math.max(width, 8)}px`,
            top: "0px",
            height: `${LANE_HEIGHT}px`,
            zIndex: isSelected ? 5 : 1,
            cursor: fadeMode ? fadeInCursor : "pointer",
          }}
          data-testid={`timeline-block-${index}`}
          data-block
          data-selected={isSelected ? "true" : undefined}
          onClick={(e) => {
            if (fadeMode) {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              const isLeftHalf = relX < rect.width / 2;
              if (isLeftHalf) {
                const toggling = fi > 0 ? 0 : fadeInTime;
                if (selectedIds.has(line.id) && selectedIds.size > 1) {
                  const targets = lyrics.filter((l) => selectedIds.has(l.id) && l.startTime !== null);
                  onFadesUpdated(targets.map((l) => ({ id: l.id, fadeIn: toggling, fadeOut: l.fadeOut ?? 0 })));
                } else {
                  onFadesUpdated([{ id: line.id, fadeIn: toggling, fadeOut: fo }]);
                }
              } else {
                const toggling = fo > 0 ? 0 : fadeOutTime;
                if (selectedIds.has(line.id) && selectedIds.size > 1) {
                  const targets = lyrics.filter((l) => selectedIds.has(l.id) && l.startTime !== null);
                  onFadesUpdated(targets.map((l) => ({ id: l.id, fadeIn: l.fadeIn ?? 0, fadeOut: toggling })));
                } else {
                  onFadesUpdated([{ id: line.id, fadeIn: fi, fadeOut: toggling }]);
                }
              }
              return;
            }
            if (dragDidMove.current) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              handleBlockSelect(e, line.id, index);
            }
          }}
          onMouseMove={fadeMode ? (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const isLeftHalf = relX < rect.width / 2;
            setGlobalFadeCursor(isLeftHalf ? "in" : "out");
          } : undefined}
        >
          <div
            className="absolute inset-0 rounded-sm overflow-hidden"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} ${isSelected ? "60%" : "50%"}, transparent)`,
              border: isSelected
                ? "1.5px solid rgba(255,255,255,0.85)"
                : line.fontSize != null
                  ? `3px solid ${color}`
                  : `1px solid color-mix(in srgb, ${color} 60%, transparent)`,
              backgroundImage: line.fontSize != null
                ? `repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(255,255,255,0.18) 2px, rgba(255,255,255,0.18) 5px)`
                : undefined,
            }}
            onMouseDown={(e) => {
              if (fadeMode) return;
              if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (!selectedIds.has(line.id)) {
                  setSelectedIds(new Set([line.id]));
                }
              }
              handleMouseDown(e, line.id, "move");
            }}
          >
          </div>
          {!fadeMode && (
            <>
              <div
                className="absolute top-0 bottom-0 cursor-col-resize z-30 hover:bg-white/20 rounded-l-sm"
                style={{ left: "-4px", width: "8px" }}
                onMouseDown={(e) => handleMouseDown(e, line.id, "start")}
              />
              <div
                className="absolute top-0 bottom-0 cursor-col-resize z-30 hover:bg-white/20 rounded-r-sm"
                style={{ right: "-4px", width: "8px" }}
                onMouseDown={(e) => handleMouseDown(e, line.id, "end")}
              />
            </>
          )}
          {fi > 0 && (
            <svg className="absolute left-0 top-0 pointer-events-none z-10" width="14" height={`${LANE_HEIGHT}px`} viewBox={`0 0 14 ${LANE_HEIGHT}`} preserveAspectRatio="none">
              <polygon points={`0,0 0,${LANE_HEIGHT} 14,0`} fill="rgba(0,0,0,0.35)" />
              <line x1="0" y1={LANE_HEIGHT} x2="14" y2="0" stroke={isSelected ? "rgba(255,255,255,0.85)" : `color-mix(in srgb, ${color} 60%, transparent)`} strokeWidth={isSelected ? "1.5" : "1"} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {fo > 0 && (
            <svg className="absolute right-0 top-0 pointer-events-none z-10" width="14" height={`${LANE_HEIGHT}px`} viewBox={`0 0 14 ${LANE_HEIGHT}`} preserveAspectRatio="none">
              <polygon points={`14,0 14,${LANE_HEIGHT} 0,0`} fill="rgba(0,0,0,0.35)" />
              <line x1="0" y1="0" x2="14" y2={LANE_HEIGHT} stroke={isSelected ? "rgba(255,255,255,0.85)" : `color-mix(in srgb, ${color} 60%, transparent)`} strokeWidth={isSelected ? "1.5" : "1"} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <span
            className="relative z-5 text-[10px] text-white pointer-events-none font-medium w-full"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: "1.3",
              wordBreak: "break-all",
              paddingLeft: "4px",
              paddingRight: "4px",
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
            }}
          >
            {line.text}
          </span>
        </div>
      );
    });
  }, [timedEntries, pixelsPerSecond, handleMouseDown, selectedIds, handleBlockSelect, fadeInTime, fadeOutTime, onFadesUpdated, lyrics, fadeMode]);

  const lockedBpmRef = useRef<number | null>(null);

  const prevTapBpmRef = useRef<number | null>(null);
  const stableCountRef = useRef(0);

  const handleTapRaw = useCallback((eventTimeStamp?: number) => {
    const now = eventTimeStamp ?? performance.now();
    const taps = tapTimesRef.current;

    if (taps.length > 0 && now - taps[taps.length - 1] > 4000) {
      tapTimesRef.current = [];
      taps.length = 0;
      lockedBpmRef.current = null;
      prevTapBpmRef.current = null;
      stableCountRef.current = 0;
    }

    taps.push(now);
    if (taps.length > 32) {
      taps.splice(0, taps.length - 32);
    }
    tapTimesRef.current = taps;
    setTapCount(taps.length);
    if (taps.length < 2) return;

    const intervals: number[] = [];
    for (let i = 1; i < taps.length; i++) {
      intervals.push(taps[i] - taps[i - 1]);
    }

    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = sorted[Math.floor(sorted.length / 2)];

    const filtered = intervals.filter(v => {
      const ratio = v / medianInterval;
      return ratio > 0.7 && ratio < 1.3;
    });
    const useIntervals = filtered.length >= 2 ? filtered : intervals;

    const sortedFiltered = [...useIntervals].sort((a, b) => a - b);
    const lo = Math.floor(sortedFiltered.length * 0.25);
    const hi = Math.ceil(sortedFiltered.length * 0.75);
    const iqrSlice = sortedFiltered.slice(lo, Math.max(hi, lo + 1));
    const iqrMedian = iqrSlice[Math.floor(iqrSlice.length / 2)];

    const finalBpm = Math.round(60000 / iqrMedian);

    if (prevTapBpmRef.current === finalBpm) {
      stableCountRef.current++;
    } else {
      stableCountRef.current = 0;
      prevTapBpmRef.current = finalBpm;
    }

    const isLocked = stableCountRef.current >= 3 && taps.length >= 6;
    setTapLocked(isLocked);
    if (isLocked) {
      lockedBpmRef.current = finalBpm;
    }

    setTapBpm(finalBpm >= 30 && finalBpm <= 300 ? finalBpm : null);
  }, []);

  const tapAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tapMode) return;
    const el = tapAreaRef.current;
    if (el) el.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleTapRaw(e.timeStamp);
      }
      if (e.key === "Escape") {
        setTapMode(false);
        tapTimesRef.current = [];
        setTapCount(0);
        setTapBpm(null);
        setTapLocked(false);
        lockedBpmRef.current = null;
        prevTapBpmRef.current = null;
        stableCountRef.current = 0;
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [tapMode, handleTapRaw]);

  const offscreenWaveRef = useRef<HTMLCanvasElement | null>(null);

  const buildOffscreenWaveform = useCallback(() => {
    if (!waveformPeaks || waveformPeaks.length === 0) return;
    const peaksLen = waveformPeaks.length;
    const W = Math.min(peaksLen, 8000);
    const H = 160;
    if (!offscreenWaveRef.current) {
      offscreenWaveRef.current = document.createElement("canvas");
    }
    const oc = offscreenWaveRef.current;
    oc.width = W;
    oc.height = H;
    const ctx = oc.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const mid = H / 2;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `hsla(0, 0%, 55%, 0.45)`);
    grad.addColorStop(0.5, `hsla(0, 0%, 55%, 0.20)`);
    grad.addColorStop(1, `hsla(0, 0%, 55%, 0.45)`);
    ctx.fillStyle = grad;
    let maxPeak = 0;
    for (let i = 0; i < peaksLen; i++) {
      if (waveformPeaks[i] > maxPeak) maxPeak = waveformPeaks[i];
    }
    const normFactor = maxPeak > 0.001 ? 1 / maxPeak : 1;
    for (let px = 0; px < W; px++) {
      const peakIdx = Math.floor((px / W) * peaksLen);
      const raw = waveformPeaks[Math.min(peakIdx, peaksLen - 1)] * normFactor;
      const val = Math.min(raw, 1);
      const barH = val * H;
      ctx.fillRect(px, mid - barH / 2, 1, barH);
    }
  }, [waveformPeaks, aHue]);

  useEffect(() => {
    buildOffscreenWaveform();
  }, [buildOffscreenWaveform]);

  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !offscreenWaveRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = totalWidth;
    const canvasH = canvas.clientHeight;
    if (canvasH <= 0 || w <= 0) return;
    canvas.width = w;
    canvas.height = canvasH;
    ctx.clearRect(0, 0, w, canvasH);
    ctx.drawImage(offscreenWaveRef.current, 0, 0, w, canvasH);
  }, [totalWidth, aHue]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => drawWaveform());
    return () => cancelAnimationFrame(raf);
  }, [drawWaveform]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => drawWaveform());
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [waveformPeaks, drawWaveform]);

  if (!hasAudio) {
    return (
      <div
        className="h-full flex items-center justify-center text-xs text-muted-foreground relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="timeline-drop-zone"
      >
        {audioDragOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none" style={{ backgroundColor: "hsla(0, 0%, 18%, 0.8)", border: "3px dashed hsl(0, 0%, 42%)", borderRadius: 8 }}>
            <span className="text-white text-lg font-bold">音楽ファイルをドロップ</span>
          </div>
        )}
        音楽ファイルをここにドロップしてください
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full select-none relative"
      onMouseDown={() => {
        if (document.activeElement && document.activeElement !== document.body) {
          (document.activeElement as HTMLElement).blur();
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="timeline-drop-zone"
    >
      {audioDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none" style={{ backgroundColor: "hsla(0, 0%, 18%, 0.8)", border: "3px dashed hsl(0, 0%, 42%)", borderRadius: 8 }}>
          <span className="text-white text-lg font-bold">音楽ファイルをドロップ</span>
        </div>
      )}
      <div className="flex items-center gap-2.5 px-3 py-2 shrink-0" style={{ backgroundColor: "hsl(0 0% 9%)", borderBottom: "1px solid hsl(0 0% 22%)" }}>
        <div className="flex items-center gap-1">
          <button
            tabIndex={-1}
            className="flex items-center justify-center w-9 h-9 rounded cursor-pointer outline-none focus:outline-none focus-visible:outline-none"
            style={{ color: "hsl(0 0% 75%)" }}
            onClick={() => seekTo(0)}
            title="先頭に戻る"
            data-testid="button-skip-to-start"
          >
            <SkipBack className="w-5 h-5" />
          </button>
          <button
            tabIndex={-1}
            className="flex items-center justify-center w-9 h-9 rounded cursor-pointer"
            style={{ backgroundColor: isPlaying ? "hsl(0 0% 18%)" : "transparent", color: "hsl(0 0% 75%)" }}
            onClick={togglePlay}
            title="再生/一時停止 (Space)"
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button
            tabIndex={-1}
            className="flex items-center justify-center w-9 h-9 rounded cursor-pointer"
            style={{ color: "hsl(0 0% 75%)" }}
            onClick={stopPlayback}
            title="停止 (先頭に戻る)"
            data-testid="button-stop"
          >
            <Square className="w-4 h-4" fill="currentColor" />
          </button>
          <button
            tabIndex={-1}
            className="flex items-center justify-center w-9 h-9 rounded cursor-pointer"
            style={{ color: "hsl(0 0% 75%)" }}
            onClick={() => { if (duration > 0) seekTo(duration); }}
            title="曲の最後へ"
            data-testid="button-skip-end"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />

        <span className="text-base font-mono font-bold tabular-nums px-1.5" style={{ color: "hsl(0 0% 88%)" }} data-testid="text-timeline-time">
          {formatTime(currentTime)}
        </span>

        {bpm && bpm > 0 && (
          <>
            <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
            <span
              className="text-base font-mono font-bold tabular-nums px-2"
              style={{ color: "hsl(0 0% 82%)" }}
              title="小節.拍"
              data-testid="text-timeline-bar-beat"
            >
              {(() => {
                const secPerBeat = 60 / bpm;
                const elapsed = currentTime - (gridOffset || 0);
                const totalBeats = elapsed / secPerBeat;
                if (totalBeats < 0) return "1.1";
                const bar = Math.floor(totalBeats / 4) + 1;
                const beat = Math.floor(totalBeats % 4) + 1;
                return bar + "." + beat;
              })()}
              <span className="text-xs font-semibold ml-1" style={{ color: "hsl(0 0% 45%)" }}>BAR</span>
            </span>
          </>
        )}

        <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />

        <div className="flex items-center gap-1">
          {bpm && !bpmEditing && (
            <button
              tabIndex={-1}
              className="text-base font-bold font-mono cursor-pointer tabular-nums px-2 py-1 rounded"
              style={{ color: "hsl(0 0% 88%)" }}
              data-testid="text-bpm"
              onClick={() => {
                setBpmEditing(true);
                setBpmEditValue("");
              }}
              title="クリックでBPM手動入力"
            >
              {Math.round(bpm)}<span className="text-xs font-semibold ml-1" style={{ color: "hsl(0 0% 45%)" }}>BPM</span>
            </button>
          )}
          {bpm && !bpmEditing && !tapMode && !bpmLoading && audioArrayBuffer && (
            <button
              tabIndex={-1}
              className="text-[10px] font-bold font-mono tracking-wider px-1.5 py-0.5 rounded transition-colors"
              style={{
                color: "hsl(0 0% 55%)",
                border: "1px solid hsl(0 0% 25%)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "hsl(30 90% 60%)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(30 80% 45%)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "hsl(0 0% 55%)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(0 0% 25%)";
              }}
              onClick={redetectBpmNow}
              data-testid="button-redetect-bpm"
              title="BPM を再検出（強化アルゴリズムで再計算）"
            >
              RE-DETECT
            </button>
          )}
          {bpm && !bpmEditing && !tapMode && (
            <div className="flex items-center gap-1 ml-1" data-testid="beat-indicator">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  ref={(el) => { beatDotsRef.current[i] = el; }}
                  className="rounded-full"
                  style={{
                    width: i === 0 ? "8px" : "6px",
                    height: i === 0 ? "8px" : "6px",
                    backgroundColor: "hsl(0 0% 22%)",
                    boxShadow: "none",
                  }}
                />
              ))}
            </div>
          )}
          {!bpmEditing && !tapMode && (
            <button
              tabIndex={-1}
              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ml-1"
              style={{
                backgroundColor: "hsl(0 0% 15%)",
                color: "hsl(0 0% 55%)",
                border: "1px solid hsl(0 0% 25%)",
              }}
              onClick={() => {
                setTapMode(true);
                tapTimesRef.current = [];
                setTapCount(0);
                setTapBpm(null);
                setTapLocked(false);
                lockedBpmRef.current = null;
                prevTapBpmRef.current = null;
                stableCountRef.current = 0;
              }}
              title="TAP BPMモード：クリックまたはスペースキーでリズムをタップ"
              data-testid="btn-tap-bpm"
            >
              TAP
            </button>
          )}
          {tapMode && (
            <div
              className="flex items-center gap-1.5 ml-1"
              tabIndex={0}
              data-testid="tap-bpm-area"
              style={{ outline: "none", touchAction: "none", userSelect: "none" }}
              ref={tapAreaRef}
            >
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded select-none"
                style={{
                  backgroundColor: tapLocked ? "hsl(140 60% 25%)" : "hsl(48 80% 20%)",
                  color: tapLocked ? "hsl(140 80% 75%)" : "hsl(48 100% 65%)",
                  border: tapLocked ? "1px solid hsl(140 70% 40%)" : "1px solid hsl(48 80% 40%)",
                  transition: "all 0.2s",
                }}
                data-testid="btn-tap"
              >
                TAP{tapCount > 0 ? ` (${tapCount})` : ""}
              </span>
              {tapBpm && (
                <span className="text-sm font-mono font-bold" style={{ color: "hsl(48 100% 55%)" }}>
                  {tapBpm}
                </span>
              )}
              {tapBpm && (
                <button
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: "hsl(48 60% 22%)",
                    color: "hsl(48 100% 65%)",
                    border: "1px solid hsl(48 80% 40%)",
                  }}
                  onClick={() => {
                    if (tapBpm) setBpm(tapBpm);
                    setTapMode(false);
                    tapTimesRef.current = [];
                    setTapCount(0);
                    setTapBpm(null);
                    setTapLocked(false);
                    lockedBpmRef.current = null;
                    prevTapBpmRef.current = null;
                    stableCountRef.current = 0;
                  }}
                  data-testid="btn-tap-apply"
                  title="このBPMを適用"
                >
                  ✓
                </button>
              )}
              <button
                className="text-[9px] font-mono px-1 py-0.5 rounded hover:bg-white/10"
                style={{ color: "hsl(0 0% 50%)" }}
                onClick={() => {
                  setTapMode(false);
                  tapTimesRef.current = [];
                  setTapCount(0);
                  setTapBpm(null);
                  setTapLocked(false);
                  lockedBpmRef.current = null;
                  prevTapBpmRef.current = null;
                  stableCountRef.current = 0;
                }}
                data-testid="btn-tap-close"
                title="TAPモードを終了"
              >
                ✕
              </button>
            </div>
          )}
          {bpmEditing && (
            <form
              className="flex items-center gap-0.5"
              onSubmit={(e) => {
                e.preventDefault();
                const val = Math.round(parseFloat(bpmEditValue));
                if (val >= 30 && val <= 300) {
                  setBpm(val);
                }
                setBpmEditing(false);
              }}
            >
              <input
                type="number"
                className="w-20 h-8 text-base font-mono font-bold bg-transparent rounded px-1.5 outline-none"
                style={{ color: "hsl(0 0% 88%)", borderColor: "hsl(0 0% 30%)", borderWidth: "1px", borderStyle: "solid" }}
                value={bpmEditValue}
                placeholder={bpm ? String(Math.round(bpm)) : ""}
                onChange={(e) => setBpmEditValue(e.target.value)}
                onBlur={() => {
                  if (bpmEditValue.trim()) {
                    const val = Math.round(parseFloat(bpmEditValue));
                    if (val >= 30 && val <= 300) {
                      setBpm(val);
                    }
                  }
                  setBpmEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setBpmEditing(false);
                }}
                autoFocus
                step="1"
                min="30"
                max="300"
                data-testid="input-bpm"
              />
            </form>
          )}
          {!bpm && !bpmEditing && (
            <button
              tabIndex={-1}
              className="text-base font-mono cursor-pointer px-2 py-1 rounded"
              style={{ color: "hsl(0 0% 30%)" }}
              onClick={() => { setBpmEditing(true); setBpmEditValue("120"); }}
            >
              ---<span className="text-xs ml-1" style={{ color: "hsl(0 0% 25%)" }}>BPM</span>
            </button>
          )}
        </div>

        {bpm && bpm > 0 && (
          <>
            <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold font-mono tracking-wider" style={{ color: "hsl(0 0% 45%)" }}>GRID</span>
              <span
                className="text-base font-bold font-mono cursor-ew-resize min-w-[80px] text-center select-none tabular-nums"
                style={{ color: isGridDragging ? "hsl(0 0% 68%)" : "hsl(0 0% 82%)", textShadow: isGridDragging ? "0 0 6px hsla(0,0%,50%,0.3)" : "none", transition: "color 0.08s ease, text-shadow 0.08s ease" }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  gridDragStartX.current = e.clientX;
                  gridDragOrigOffset.current = gridOffset;
                  setIsGridDragging(true);
                }}
                onDoubleClick={() => { setGridOffset(0); onBpmGridOffsetChange?.(0); }}
                title="左右ドラッグで微調整 / ダブルクリックでリセット"
                data-testid="text-grid-offset"
              >
                {gridOffset >= 0 ? "+" : ""}{gridOffset.toFixed(3)}s
              </span>
              <button
                tabIndex={-1}
                className="text-[10px] font-bold font-mono tracking-wider px-2 py-1 rounded transition-colors"
                style={{
                  color: "hsl(0 0% 70%)",
                  border: "1px solid hsl(0 0% 30%)",
                  backgroundColor: "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "hsl(30 90% 60%)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(30 80% 45%)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "hsl(0 0% 70%)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(0 0% 30%)";
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // 再生ヘッドがある場所を 1小節目（BAR 1）に設定
                  const nowT = audioRef.current ? audioRef.current.currentTime : currentTimeRef.current;
                  if (typeof nowT === "number" && Number.isFinite(nowT) && nowT >= 0) {
                    setGridOffset(nowT);
                    onBpmGridOffsetChange?.(nowT);
                  }
                }}
                title="再生ヘッドの現在位置を 1小節目 に設定"
                data-testid="button-set-bar-1"
              >
                SET BAR 1
              </button>
            </div>
          </>
        )}
        {bpmLoading && (
          <span className="text-xs text-muted-foreground font-mono animate-pulse">
            BPM検出中...
          </span>
        )}

        <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />

        <div className="flex items-center gap-1" data-testid="panel-fade-settings">
          <button
            className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded transition-colors"
            style={{
              color: fadeMode ? "hsl(48 100% 50%)" : "hsl(0 0% 45%)",
              backgroundColor: fadeMode ? "hsl(48 100% 50% / 0.15)" : "transparent",
              border: fadeMode ? "1px solid hsl(48 80% 40%)" : "1px solid transparent",
              cursor: "pointer",
            }}
            onClick={() => setFadeMode(!fadeMode)}
            title="フェードモード切替 (F)"
            tabIndex={-1}
            data-testid="button-fade-toggle"
          >FADE</button>
          <input
            type="text"
            inputMode="decimal"
            value={fadeTimeInput}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "" || /^\d*\.?\d{0,2}$/.test(raw)) {
                setFadeTimeInput(raw);
                const v = parseFloat(raw);
                if (!isNaN(v) && v >= 0 && v <= 10) {
                  const rounded = Math.round(v * 100) / 100;
                  setFadeInTime(rounded);
                  setFadeOutTime(rounded);
                }
              }
            }}
            onBlur={() => {
              const v = Math.min(10, Math.max(0, parseFloat(fadeTimeInput) || 0));
              const rounded = Math.round(v * 100) / 100;
              setFadeInTime(rounded);
              setFadeOutTime(rounded);
              setFadeTimeInput(String(rounded));
              if (rounded > 0) {
                const updates = lyrics
                  .filter((l) => l.startTime !== null && ((l.fadeIn ?? 0) > 0 || (l.fadeOut ?? 0) > 0))
                  .map((l) => ({
                    id: l.id,
                    fadeIn: (l.fadeIn ?? 0) > 0 ? rounded : 0,
                    fadeOut: (l.fadeOut ?? 0) > 0 ? rounded : 0,
                  }));
                if (updates.length > 0) onFadesUpdated(updates);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            className="text-sm font-bold font-mono text-center rounded"
            style={{
              backgroundColor: "transparent",
              border: "1px solid hsl(0 0% 30%)",
              color: "hsl(0 0% 88%)",
              outline: "none",
              width: 48,
              height: 28,
              padding: "0 4px",
              lineHeight: "28px",
              MozAppearance: "textfield" as any,
            }}
            title="フェード秒数 (0〜5)"
            data-testid="input-fade-time"
          />
          <span className="text-xs font-semibold font-mono" style={{ color: "hsl(0 0% 45%)" }}>s</span>
        </div>

        <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />

        <div className="flex items-center gap-1">
          <span className="text-xs font-mono font-semibold mr-1" style={{ color: "hsl(0 0% 45%)" }}>ZOOM</span>
          <kbd
            className="text-sm font-mono font-bold leading-none select-none cursor-pointer"
            style={{ color: zoomKeyA ? "hsl(48 100% 50%)" : "hsl(0 0% 68%)", backgroundColor: zoomKeyA ? "hsl(0 0% 18%)" : "hsl(0 0% 16%)", border: zoomKeyA ? "1px solid hsl(48 100% 45%)" : "1px solid hsl(0 0% 26%)", borderBottom: zoomKeyA ? "2px solid hsl(48 100% 40%)" : "2px solid hsl(0 0% 22%)", borderRadius: 5, padding: "5px 10px", boxShadow: zoomKeyA ? "0 0 8px hsla(48,100%,50%,0.3)" : "0 1px 2px rgba(0,0,0,0.4)", transition: "all 0.08s ease" }}
            onMouseDown={() => {
              setZoomKeyA(true);
              zoomLastStepRef.current = 0;
              zoomAroundPlayhead("out");
              const iv = setInterval(() => zoomAroundPlayhead("out"), 200);
              const up = () => { clearInterval(iv); setZoomKeyA(false); window.removeEventListener("mouseup", up); };
              window.addEventListener("mouseup", up);
            }}
          >{zoomOutLabel || "A"}</kbd>
          <input
            type="range"
            min={getMinZoom()}
            max={200}
            step={1}
            value={zoom}
            onChange={(e) => {
              const next = Math.max(getMinZoom(), Number(e.target.value));
              const ct = currentTimeRef.current;
              const el = timelineRef.current;
              if (el) {
                const newScroll = Math.max(0, ct * next - el.clientWidth / 2);
                zoomIntendedScrollRef.current = newScroll;
                zoomScrollSuppressRef.current = Date.now();
                setZoom(next);
                el.scrollLeft = newScroll;
              } else {
                setZoom(next);
              }
            }}
            className="timeline-zoom-slider w-24"
            data-testid="slider-zoom"
            tabIndex={-1}
          />
          <kbd
            className="text-sm font-mono font-bold leading-none select-none cursor-pointer"
            style={{ color: zoomKeyD ? "hsl(48 100% 50%)" : "hsl(0 0% 68%)", backgroundColor: zoomKeyD ? "hsl(0 0% 18%)" : "hsl(0 0% 16%)", border: zoomKeyD ? "1px solid hsl(48 100% 45%)" : "1px solid hsl(0 0% 26%)", borderBottom: zoomKeyD ? "2px solid hsl(48 100% 40%)" : "2px solid hsl(0 0% 22%)", borderRadius: 5, padding: "5px 10px", boxShadow: zoomKeyD ? "0 0 8px hsla(48,100%,50%,0.3)" : "0 1px 2px rgba(0,0,0,0.4)", transition: "all 0.08s ease" }}
            onMouseDown={() => {
              setZoomKeyD(true);
              zoomLastStepRef.current = 0;
              zoomAroundPlayhead("in");
              const iv = setInterval(() => zoomAroundPlayhead("in"), 200);
              const up = () => { clearInterval(iv); setZoomKeyD(false); window.removeEventListener("mouseup", up); };
              window.addEventListener("mouseup", up);
            }}
          >{zoomInLabel || "D"}</kbd>
        </div>

        <div className="w-px h-7" style={{ backgroundColor: "hsl(0 0% 22%)" }} />

        <div className="flex items-center rounded overflow-hidden" style={{ border: snapEnabled ? "1px solid hsla(48 100% 50% / 0.35)" : "1px solid hsl(0 0% 25%)" }}>
          <button
            tabIndex={-1}
            className="text-[10px] font-mono font-semibold px-2 py-1.5"
            style={{
              color: snapEnabled ? "hsl(48 100% 50%)" : "hsl(0 0% 40%)",
              backgroundColor: snapEnabled ? "hsla(48 100% 50% / 0.12)" : "transparent",
            }}
            onClick={() => {
              const next = !snapEnabled;
              setSnapEnabled(next);
              if (next && bpm && bpm > 0) {
                const snapInterval = 60 / bpm / quantizeDiv;
                const currentOffset = gridOffsetRef.current;
                const timedLines = displayLyrics.filter((l) => l.startTime !== null && l.endTime !== null);
                if (timedLines.length === 0) return;
                const snapped = timedLines.map((l) => {
                  const st = l.startTime || 0;
                  const et = l.endTime || 0;
                  const dur = et - st;
                  let snappedStart = Math.round((st - currentOffset) / snapInterval) * snapInterval + currentOffset;
                  let snappedEnd = snappedStart + Math.max(snapInterval, Math.round(dur / snapInterval) * snapInterval);
                  snappedStart = Math.max(0, snappedStart);
                  snappedEnd = Math.min(duration, snappedEnd);
                  if (snappedEnd <= snappedStart) snappedEnd = snappedStart + snapInterval;
                  return {
                    id: l.id,
                    startTime: snappedStart,
                    endTime: snappedEnd,
                  };
                });
                snapped.sort((a, b) => a.startTime - b.startTime);
                for (let i = snapped.length - 2; i >= 0; i--) {
                  if (snapped[i].endTime > snapped[i + 1].startTime) {
                    snapped[i].endTime = snapped[i + 1].startTime;
                  }
                }
                onTimingsUpdated(snapped);
              }
            }}
            disabled={!bpm}
            data-testid="button-quantize"
            title={snapEnabled ? "QUANTIZE ON (クリックでOFF)" : "QUANTIZE OFF (クリックでON)"}
          >
            Q
          </button>
          <div className="w-px h-4" style={{ backgroundColor: "hsl(0 0% 25%)" }} />
          <button
            tabIndex={-1}
            className="text-[10px] font-mono font-bold px-2 py-1.5"
            style={{
              color: quantizeDiv === 2 ? "hsl(48 100% 50%)" : "hsl(0 0% 45%)",
              backgroundColor: quantizeDiv === 2 ? "hsla(48 100% 50% / 0.15)" : "transparent",
            }}
            onClick={() => setQuantizeDiv(2)}
            data-testid="button-quantize-8th"
            title="8分音符でクオンタイズ"
          >
            ♪8
          </button>
          <div className="w-px h-4" style={{ backgroundColor: "hsl(0 0% 25%)" }} />
          <button
            tabIndex={-1}
            className="text-[10px] font-mono font-bold px-2 py-1.5"
            style={{
              color: quantizeDiv === 4 ? "hsl(48 100% 50%)" : "hsl(0 0% 45%)",
              backgroundColor: quantizeDiv === 4 ? "hsla(48 100% 50% / 0.15)" : "transparent",
            }}
            onClick={() => setQuantizeDiv(4)}
            data-testid="button-quantize-16th"
            title="16分音符でクオンタイズ"
          >
            ♬16
          </button>
        </div>

        <button
          tabIndex={-1}
          className="text-[10px] font-mono font-bold px-1.5 py-1 rounded hover:bg-white/10 ml-2"
          style={{ color: markers && markers.length > 0 ? "hsl(0 70% 55%)" : "hsl(0 0% 35%)" }}
          onClick={() => {
            if (markers && markers.length > 0) {
              onMarkersChangeRef.current?.([]);
              setSelectedMarkerIds(new Set());
            }
          }}
          disabled={!markers || markers.length === 0}
          data-testid="button-marker-reset"
          title="全マーカーを削除"
        >
          ▼RESET
        </button>

        <div className="flex-1" />

        {audioTracks && audioTracks.length > 0 && activeAudioTrackId && (() => {
          const active = audioTracks.find(t => t.id === activeAudioTrackId);
          if (!active) return null;
          return (
            <span
              className="text-[11px] font-mono truncate max-w-[200px]"
              style={{ color: "hsl(0 0% 40%)" }}
              title={active.fileName}
              data-testid="text-audio-filename"
            >
              {active.fileName}
            </span>
          );
        })()}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        {waveformLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none" style={{ backgroundColor: "hsla(0, 0%, 5%, 0.7)" }}>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(0 0% 55%)" }} />
              <span className="text-[11px] font-mono" style={{ color: "hsl(0 0% 60%)" }}>ANALYZING AUDIO...</span>
            </div>
          </div>
        )}

        {(() => {
          const activeLanes = 2;
          const blocksZoneH = 18 + activeLanes * (LANE_HEIGHT + LANE_GAP) + 4;
          const TRACK_GAP = 2;
          const WAVE_H = waveformPeaks ? 56 : 0;
          const AUDIO_BLOCK_H = waveformPeaks ? SECTION_BAND_H + WAVE_H : 0;
          const totalH = blocksZoneH + (waveformPeaks ? TRACK_GAP + AUDIO_BLOCK_H : 0);
          const HEADER_W = 56;
          return (
            <div className="flex-1 flex overflow-hidden relative">
              <div
                className="shrink-0 flex flex-col z-10"
                style={{ width: `${HEADER_W}px` }}
              >
                <div
                  className="flex items-center gap-1.5"
                  style={{
                    height: `${blocksZoneH}px`,
                    backgroundColor: "hsl(0 0% 7%)",
                    borderRight: "1px solid hsl(0 0% 22%)",
                    paddingLeft: "4px",
                  }}
                >
                  <div style={{ width: "3px", height: "100%", backgroundColor: "hsl(48 100% 45%)", borderRadius: "1px", flexShrink: 0, alignSelf: "stretch" }} />
                  <div className="flex flex-col items-start justify-center">
                    <span className="text-[13px] font-mono font-black leading-none" style={{ color: "hsl(48 100% 50%)" }}>T</span>
                    <span className="text-[7px] font-mono font-semibold leading-tight" style={{ color: "hsl(0 0% 85%)" }}>TELOP</span>
                  </div>
                </div>
                {waveformPeaks && (
                  <>
                    <div style={{ height: `${TRACK_GAP}px`, backgroundColor: "hsl(0 0% 5%)" }} />
                    <div
                      className="flex items-center gap-1.5 relative"
                      style={{
                        height: `${AUDIO_BLOCK_H}px`,
                        backgroundColor: "hsl(0 0% 7%)",
                        borderRight: "1px solid hsl(0 0% 22%)",
                        paddingLeft: "4px",
                      }}
                    >
                      <div style={{ width: "3px", height: "100%", backgroundColor: "hsl(48 100% 45%)", borderRadius: "1px", flexShrink: 0, alignSelf: "stretch" }} />
                      <div className="flex flex-col items-start justify-center" style={{ minWidth: 0, overflow: "hidden" }}>
                        <span className="text-[13px] font-mono font-black leading-none" style={{ color: "hsl(48 100% 50%)" }}>A</span>
                        <span className="text-[7px] font-mono font-semibold leading-tight" style={{ color: "hsl(0 0% 85%)" }}>AUDIO</span>
                        <span className="text-[7px] font-mono font-semibold leading-tight" style={{ color: "hsl(0 0% 50%)", marginTop: 4 }}>+ SEC</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 relative">
              {/* SECTION ブロック帯：sectionBlocks がマスター。空の時は譜割タブから派生表示（読み取り専用、破線） */}
              {bpm && bpm > 0 && (() => {
                const beatsPerBar = 4;
                const secPerBar = (60 / bpm) * beatsPerBar;
                const offset = gridOffsetRef.current || 0;
                // 譜割タブからの派生：scoreRows の各行を順に走査し、SECTION 名が現れた位置から
                // 次の SECTION 名（または曲末尾）までを 1 ブロックとして扱う。bars 列の数字を
                // 累積して開始小節 / 終了小節を計算する。データ加工なし、読み取り専用。
                const deriveBlocksFromScore = (): { id: string; label: string; startBar: number; endBar: number }[] => {
                  if (!scoreRows || scoreRows.length === 0) return [];
                  const result: { id: string; label: string; startBar: number; endBar: number }[] = [];
                  let cumBars = 0;
                  let current: { id: string; label: string; startBar: number; endBar: number } | null = null;
                  for (const row of scoreRows) {
                    const secLines = row.section.split("\n");
                    const barLines = row.bars.split("\n");
                    const maxLines = Math.max(secLines.length, barLines.length);
                    for (let i = 0; i < maxLines; i++) {
                      const label = (secLines[i] || "").trim();
                      if (label) {
                        if (current) {
                          current.endBar = cumBars;
                          if (current.endBar > current.startBar) result.push(current);
                        }
                        current = { id: `derived-${row.id}-${i}`, label, startBar: cumBars, endBar: cumBars };
                      }
                      const barText = barLines[i] || "";
                      const nums = barText.match(/\d+/g) || [];
                      const barSum = nums.reduce((s, n) => s + parseInt(n, 10), 0);
                      cumBars += barSum;
                    }
                  }
                  if (current) {
                    current.endBar = cumBars;
                    if (current.endBar > current.startBar) result.push(current);
                  }
                  return result;
                };
                const manualBlocks = sectionBlocks || [];
                const isDerived = manualBlocks.length === 0;
                const blocks = isDerived ? deriveBlocksFromScore() : manualBlocks;
                // SECTION 名から基本色を返す（カテゴリ別）
                const baseColorFor = (label: string) => {
                  const l = (label || "").trim().toUpperCase();
                  if (l === "INTRO") return { bg: "#1d4d63", border: "#2a6b87", text: "#b6e2f5" };
                  if (l === "INTER" || l === "インター") return { bg: "#5f3a1f", border: "#8b5b2c", text: "#f0c490" };
                  if (l === "BRIDGE" || l === "ブリッジ") return { bg: "#5c3a1f", border: "#7e4d24", text: "#f0c490" };
                  if (l === "OUTRO" || l === "アウトロ") return { bg: "#5c1f1f", border: "#8e2f2f", text: "#ecb3b3" };
                  if (/^[1１]/.test(l)) return { bg: "#1f3d5c", border: "#305887", text: "#b3cdec" };
                  if (/^[2２]/.test(l)) return { bg: "#1f5c3a", border: "#2f8757", text: "#b3ecc8" };
                  if (/^[3３]/.test(l)) return { bg: "#5c1f3d", border: "#8e2f5c", text: "#ecb3cd" };
                  return { bg: "#2c2c2a", border: "#46463f", text: "#ece6d8" };
                };
                // 16 進色を少し明るく（隣接同色を見分けるための差分）
                const liftColor = (hex: string, amount = 24) => {
                  const m = hex.match(/^#([0-9a-f]{6})$/i);
                  if (!m) return hex;
                  const n = parseInt(m[1], 16);
                  const r = Math.min(255, ((n >> 16) & 0xff) + amount);
                  const g = Math.min(255, ((n >> 8) & 0xff) + amount);
                  const bch = Math.min(255, (n & 0xff) + amount);
                  return "#" + [r, g, bch].map(v => v.toString(16).padStart(2, "0")).join("");
                };
                // 隣接ブロックの色が一致したら「明るい変種」に切り替えて境目を視認できるようにする
                const blockColors = blocks.map((bb, i) => {
                  let c = baseColorFor(bb.label);
                  if (i > 0) {
                    const prev = baseColorFor(blocks[i - 1].label);
                    // 直前と同カテゴリ → 1 段階ずらす（直前が「素」なら今度は「明」、逆も同じ）
                    if (prev.bg === c.bg) {
                      c = { bg: liftColor(c.bg), border: liftColor(c.border), text: c.text };
                    }
                  }
                  return c;
                });
                const colorFor = (_label: string, idx: number) => blockColors[idx];
                // TELOP と同じ snapToBeat を使う：BPM × quantizeDiv で見えてるグリッドにスナップ。
                // Alt キーで一時的にスナップ無効（自由配置）にできる。
                // 結果は 1/256 小節単位で丸めて、time→bar 変換時の浮動小数点誤差（2.00000001 等）を消す。
                const snapBar = (bar: number, e: MouseEvent) => {
                  if (e.altKey) {
                    return Math.max(0, Math.round(bar * 256) / 256);
                  }
                  const time = offset + bar * secPerBar;
                  const snappedTime = snapToBeat(time, true);
                  const result = Math.max(0, (snappedTime - offset) / secPerBar);
                  return Math.round(result * 256) / 256;
                };
                const onBlockMouseDown = (ev: React.MouseEvent, b: any, mode: "move" | "left" | "right") => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const startMouseX = ev.clientX;
                  const origStart = b.startBar;
                  const origEnd = b.endBar;
                  // 派生表示中に編集が始まったら、その時点で表示中の全ブロックを手動データへ昇格させる
                  const snapshot = blocks;
                  sectionBlockDidMove.current = false;
                  // 隣接ブロック検出（TELOP と同じ：右端ドラッグなら次の startBar 一致、左端ドラッグなら前の endBar 一致）
                  // Cmd/Ctrl で「リンク解除」＝隣接が連動せず単独で動く（隙間が開く）
                  let linkedId: string | null = null;
                  let linkedOrigStart = 0;
                  let linkedOrigEnd = 0;
                  if (mode === "right") {
                    const linked = snapshot.find(x => x.id !== b.id && Math.abs(x.startBar - origEnd) < 0.01);
                    if (linked) {
                      linkedId = linked.id;
                      linkedOrigStart = linked.startBar;
                      linkedOrigEnd = linked.endBar;
                    }
                  } else if (mode === "left") {
                    const linked = snapshot.find(x => x.id !== b.id && Math.abs(x.endBar - origStart) < 0.01);
                    if (linked) {
                      linkedId = linked.id;
                      linkedOrigStart = linked.startBar;
                      linkedOrigEnd = linked.endBar;
                    }
                  }
                  // RAF バッチ：mousemove ごとに setState せず、次の frame 直前に最新値だけ反映
                  let rafId: number | null = null;
                  let pendingNext: typeof snapshot | null = null;
                  const flush = () => {
                    rafId = null;
                    if (pendingNext) {
                      onSectionBlocksChange?.(pendingNext);
                      pendingNext = null;
                    }
                  };
                  const onMove = (me: MouseEvent) => {
                    const dx = me.clientX - startMouseX;
                    if (!sectionBlockDidMove.current && Math.abs(dx) < 3) return;
                    sectionBlockDidMove.current = true;
                    const barsDx = dx / (secPerBar * pixelsPerSecond);
                    const breakLinked = me.metaKey || me.ctrlKey;

                    // 動かす対象（自分 + linked が連動するなら linked）。これら以外を「壁」として扱う。
                    const movingIds = new Set<string>([b.id]);
                    if (linkedId && !breakLinked) movingIds.add(linkedId);
                    const wallBlocks = snapshot.filter(x => !movingIds.has(x.id));

                    // ① 自分の暫定位置を計算（既存ロジック）
                    let newSelfStart = origStart;
                    let newSelfEnd = origEnd;
                    if (mode === "left") {
                      let n = snapBar(origStart + barsDx, me);
                      n = Math.max(0, Math.min(b.endBar - 0.25, n));
                      newSelfStart = n;
                    } else if (mode === "right") {
                      let n = snapBar(origEnd + barsDx, me);
                      n = Math.max(b.startBar + 0.25, n);
                      newSelfEnd = n;
                    } else {
                      const len = origEnd - origStart;
                      let n = snapBar(origStart + barsDx, me);
                      n = Math.max(0, n);
                      newSelfStart = n;
                      newSelfEnd = n + len;
                    }

                    // ② 重なり防止クランプ（歌詞ブロックと同じ思想：他ブロックの境界が壁になって止まる）
                    for (const o of wallBlocks) {
                      if (mode === "left") {
                        // 左端を動かす：左にある他ブロックの endBar より下には行けない
                        if (newSelfStart < o.endBar && o.endBar <= origStart) {
                          newSelfStart = Math.max(newSelfStart, o.endBar);
                        }
                      } else if (mode === "right") {
                        // 右端を動かす：右にある他ブロックの startBar より上には行けない
                        if (newSelfEnd > o.startBar && o.startBar >= origEnd) {
                          newSelfEnd = Math.min(newSelfEnd, o.startBar);
                        }
                      } else {
                        // 全体移動：自分の範囲が他と重なるなら、近い側の境界に寄せて押し戻す
                        if (newSelfStart < o.endBar && newSelfEnd > o.startBar) {
                          const len = origEnd - origStart;
                          const overlapLeft = o.endBar - newSelfStart;
                          const overlapRight = newSelfEnd - o.startBar;
                          if (overlapLeft < overlapRight) {
                            newSelfStart = o.endBar;
                            newSelfEnd = newSelfStart + len;
                          } else {
                            newSelfEnd = o.startBar;
                            newSelfStart = newSelfEnd - len;
                          }
                        }
                      }
                    }

                    // ③ linked（隣接連動）の暫定位置を計算
                    let newLinkedStart = linkedOrigStart;
                    let newLinkedEnd = linkedOrigEnd;
                    if (linkedId && !breakLinked) {
                      if (mode === "right") {
                        // 自分の右端と一緒に隣接の左端（startBar）が動く
                        // ただし、自分の右端が壁で止まったなら linked も同じ位置で止まる
                        let n = newSelfEnd;
                        n = Math.max(0, Math.min(linkedOrigEnd - 0.25, n));
                        newLinkedStart = n;
                      } else if (mode === "left") {
                        // 自分の左端と一緒に隣接の右端（endBar）が動く
                        let n = newSelfStart;
                        n = Math.max(linkedOrigStart + 0.25, n);
                        newLinkedEnd = n;
                      }
                      // linked の側も他のブロック（移動対象以外）と重ならないようにクランプ
                      for (const o of wallBlocks) {
                        if (mode === "right") {
                          if (newLinkedStart < o.endBar && o.endBar <= linkedOrigStart) {
                            newLinkedStart = Math.max(newLinkedStart, o.endBar);
                          }
                        } else if (mode === "left") {
                          if (newLinkedEnd > o.startBar && o.startBar >= linkedOrigEnd) {
                            newLinkedEnd = Math.min(newLinkedEnd, o.startBar);
                          }
                        }
                      }
                    }

                    // ④ 結果を pendingNext に反映
                    pendingNext = snapshot.map(x => {
                      if (x.id === b.id) {
                        return { ...x, startBar: newSelfStart, endBar: newSelfEnd };
                      }
                      if (linkedId === x.id && !breakLinked) {
                        return { ...x, startBar: newLinkedStart, endBar: newLinkedEnd };
                      }
                      return x;
                    });
                    if (rafId == null) rafId = requestAnimationFrame(flush);
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    // 最後の保留分を flush
                    if (rafId != null) {
                      cancelAnimationFrame(rafId);
                      rafId = null;
                    }
                    if (pendingNext) {
                      onSectionBlocksChange?.(pendingNext);
                      pendingNext = null;
                    }
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                };
                return (
                  <div
                    className="absolute left-0 right-0 z-30 overflow-hidden"
                    style={{ top: blocksZoneH + TRACK_GAP, height: SECTION_BAND_H, borderTop: "1px solid hsl(0 0% 14%)", borderBottom: "1px solid hsl(0 0% 14%)" }}
                    onDoubleClick={(e) => {
                      // 既存ブロックの上のダブルクリックはラベル編集に任せる
                      const t = e.target as HTMLElement;
                      if (t.closest("[data-section-block]")) return;
                      // クリック位置 → bar 計算 → 親に通知
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const xInBand = e.clientX - rect.left + tlScrollLeft;
                      const time = xInBand / pixelsPerSecond;
                      const bar = (time - offset) / secPerBar;
                      onSectionAddAtRef.current?.(bar);
                    }}
                  >
                    <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: -tlScrollLeft, zIndex: 0 }}>
                      {bpmGridLines}
                    </div>
                    <div className="absolute top-0 bottom-0" style={{ left: -tlScrollLeft }}>
                      {blocks.map((b, idx) => {
                        const startTime = offset + b.startBar * secPerBar;
                        const x = startTime * pixelsPerSecond;
                        const w = (b.endBar - b.startBar) * secPerBar * pixelsPerSecond;
                        const c = colorFor(b.label, idx);
                        const len = b.endBar - b.startBar;
                        return (
                          <div
                            key={b.id}
                            className="absolute flex items-center justify-center group"
                            style={{ left: x, top: 4, width: w, height: SECTION_BAND_H - 8, color: c.text, userSelect: "none", cursor: "move", opacity: isDerived ? 0.9 : 1 }}
                            data-testid={`tl-section-${b.id}`}
                            data-section-block
                            onMouseDown={(e) => onBlockMouseDown(e, b, "move")}
                            onClick={(e) => {
                              // ドラッグ後の click は無視（誤発火防止）
                              if (sectionBlockDidMove.current) {
                                e.preventDefault();
                                e.stopPropagation();
                                sectionBlockDidMove.current = false;
                              }
                            }}
                            onDoubleClick={(e) => {
                              const t = e.target as HTMLElement;
                              if (t.dataset.handle || t.dataset.del) return;
                              e.stopPropagation();
                              const newName = window.prompt("SECTION 名を編集", b.label);
                              if (newName !== null) {
                                onSectionBlocksChange?.(blocks.map(x => x.id === b.id ? { ...x, label: newName } : x));
                              }
                            }}
                            title={isDerived ? "譜割タブから派生中。ドラッグで編集モードに切り替え。ダブルクリックで名前編集。Alt でフリー配置。Cmd で隣接ブロックとの隙間を開く。" : "ダブルクリックで名前編集。Alt でフリー配置。Cmd で隣接ブロックとの隙間を開く。"}
                          >
                            <div
                              className="absolute inset-0 rounded-sm overflow-hidden pointer-events-none"
                              style={{
                                backgroundColor: c.bg,
                                border: `1px ${isDerived ? "dashed" : "solid"} ${c.border}`,
                              }}
                            />
                            <div
                              data-handle="left"
                              className="absolute top-0 bottom-0 cursor-col-resize z-30 hover:bg-white/20 rounded-l-sm"
                              style={{ left: "-4px", width: "8px" }}
                              onMouseDown={(e) => { e.stopPropagation(); onBlockMouseDown(e, b, "left"); }}
                            />
                            <div
                              data-handle="right"
                              className="absolute top-0 bottom-0 cursor-col-resize z-30 hover:bg-white/20 rounded-r-sm"
                              style={{ right: "-4px", width: "8px" }}
                              onMouseDown={(e) => { e.stopPropagation(); onBlockMouseDown(e, b, "right"); }}
                            />
                            <div className="relative z-5 pointer-events-none" style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap", padding: "0 8px" }}>
                              <span style={{ fontSize: w < 50 ? 10 : 11, fontWeight: 700, letterSpacing: "0.04em" }}>{b.label}</span>
                              {w >= 50 && (() => {
                                const lenRounded = Math.round(len * 100) / 100;
                                const lenIsInt = Math.abs(lenRounded - Math.round(lenRounded)) < 0.01;
                                const lenText = lenIsInt ? `${Math.round(lenRounded)}` : `${lenRounded}`;
                                return (
                                  <span style={{ fontSize: 8, opacity: 0.7, fontWeight: 500 }}>{lenText}</span>
                                );
                              })()}
                            </div>
                            <button
                              data-del="1"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); onSectionBlocksChange?.(blocks.filter(x => x.id !== b.id)); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ position: "absolute", top: 2, right: 4, background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.85)", border: 0, width: 14, height: 14, borderRadius: "50%", cursor: "pointer", fontSize: 10, lineHeight: "12px", padding: 0, zIndex: 31 }}
                              title="削除"
                            >×</button>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => {
                        const last = blocks.reduce((m, b) => Math.max(m, b.endBar), 0);
                        const id = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
                        onSectionBlocksChange?.([...blocks, { id, label: "NEW", startBar: last, endBar: last + 4 }]);
                      }}
                      style={{ position: "absolute", top: 4, right: 6, background: "rgba(229,191,61,0.15)", color: "hsl(48 100% 60%)", border: "1px solid hsl(48 70% 35%)", borderRadius: 3, padding: "2px 8px", fontSize: 10, cursor: "pointer", zIndex: 5 }}
                      title="末尾に SECTION を追加（4 小節）"
                    >+ 追加</button>
                  </div>
                );
              })()}
              {waveformPeaks && !(bpm && bpm > 0) && (
                <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: blocksZoneH + TRACK_GAP, height: SECTION_BAND_H, borderTop: "1px solid hsl(0 0% 14%)", borderBottom: "1px solid hsl(0 0% 14%)", display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(0 0% 35%)", fontSize: 10, letterSpacing: "0.1em" }}>
                  BPM 検出後に SECTION ブロックを配置できます
                </div>
              )}
              <div
                ref={timelineRef}
                className="absolute inset-0 overflow-x-auto overflow-y-hidden cursor-crosshair select-none scrollbar-hide"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none", top: 0 }}
                data-testid="area-timeline-blocks"
                data-pps={pixelsPerSecond}
                data-duration={duration}
                onScroll={(e) => setTlScrollLeft(e.currentTarget.scrollLeft)}
                onMouseDown={(e) => {
                  if (document.activeElement && document.activeElement !== document.body) {
                    (document.activeElement as HTMLElement).blur();
                  }
                  if (creditDragActive) return;
                  if ((e.target as HTMLElement).closest("[data-credit-anim-handle]")) return;
                  if ((e.target as HTMLElement).closest("[data-block]") || (e.target as HTMLElement).closest("[data-playhead-tl]") || (e.target as HTMLElement).closest("[data-ruler]")) return;
                  e.preventDefault();
                  const rect = timelineRef.current!.getBoundingClientRect();
                  const scrollLeft = timelineRef.current!.scrollLeft;
                  const x = e.clientX - rect.left + scrollLeft;
                  startRubberBand(x, e.clientX);
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/x-lyric-id") || e.dataTransfer.types.includes("application/x-credit-title")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    const rect = timelineRef.current!.getBoundingClientRect();
                    const scrollLeft = timelineRef.current!.scrollLeft;
                    const x = e.clientX - rect.left + scrollLeft;
                    let t = Math.max(0, Math.min(duration > 0 ? duration : Infinity, pixelsToTime(x)));
                    t = snapToBeat(t);
                    setDropPreviewX(t * pixelsPerSecond);
                  } else if (e.dataTransfer.types.includes("Files")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDragLeave={(e) => {
                  const related = e.relatedTarget as Node | null;
                  if (!related || !timelineRef.current?.contains(related)) {
                    setDropPreviewX(null);
                  }
                }}
                onDrop={(e) => {
                  setDropPreviewX(null);
                  const types = Array.from(e.dataTransfer.types);
                  const isCreditDrop = types.includes("application/x-credit-title");
                  const lyricId = e.dataTransfer.getData("application/x-lyric-id");
                  if (!isCreditDrop && !lyricId) {
                    if (e.dataTransfer.types.includes("Files")) {
                      setAudioDragOver(false);
                      const files = e.dataTransfer.files;
                      if (files.length > 0) {
                        const file = files[0];
                        const fext = file.name.split(".").pop()?.toLowerCase() || "";
                        if (fext === "telop") return;
                        e.preventDefault();
                        e.stopPropagation();
                        const audioExts = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma", "opus", "webm", "mp4"];
                        if (file.type.startsWith("audio/") || audioExts.includes(fext)) {
                          onAudioDrop?.(file);
                        }
                      }
                    }
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  if (duration <= 0) return;
                  const rect = timelineRef.current!.getBoundingClientRect();
                  const scrollLeft = timelineRef.current!.scrollLeft;
                  const x = e.clientX - rect.left + scrollLeft;

                  if (isCreditDrop) {
                    let dropTime = Math.max(0, Math.min(duration, pixelsToTime(x)));
                    dropTime = snapToBeat(dropTime);
                    dropTime = Math.max(0, dropTime);
                    const outTime = creditOutTime ?? Math.min(duration, dropTime + 10);
                    const finalOut = outTime < dropTime ? dropTime + 5 : outTime;
                    onCreditTimingChangeRef.current?.(dropTime, finalOut);
                    const currentBpmVal = bpmRef.current;
                    const beatMsDrop = currentBpmVal && currentBpmVal > 0 ? (60 / currentBpmVal) * 1000 : null;
                    const dropAnimDur = beatMsDrop ? beatMsDrop * 16 : 6700;
                    const dropWipeMs = beatMsDrop ? beatMsDrop * 12 : 6700 * 3 / 4;
                    onCreditAnimDurationChangeRef.current?.(dropAnimDur);
                    onCreditWipeStartMsChangeRef.current?.(dropWipeMs);
                    return;
                  }

                  const currentBpm = bpmRef.current;
                  const twoMeasureDuration = currentBpm && currentBpm > 0
                    ? (60 / currentBpm) * 4 * 2
                    : 4;
                  const minBlockLen = 0.1;
                  let dropTime = Math.max(0, Math.min(duration - minBlockLen, pixelsToTime(x)));
                  dropTime = snapToBeat(dropTime);
                  dropTime = Math.max(0, Math.min(duration - minBlockLen, dropTime));
                  const endTime = Math.min(duration, dropTime + twoMeasureDuration);
                  onTimingsUpdatedRef.current([{
                    id: lyricId!,
                    startTime: dropTime,
                    endTime: endTime,
                  }]);
                }}
              >
                <div
                  className="relative"
                  style={{ width: `${totalWidth}px`, minHeight: "100%", height: `${totalH}px` }}
                >
                  <div
                    className="absolute left-0 right-0 top-0"
                    style={{
                      height: `${blocksZoneH}px`,
                      backgroundColor: "hsl(0 0% 7%)",
                    }}
                  >
                    <div
                      data-ruler
                      className="absolute left-0 right-0 top-0 z-20 cursor-col-resize"
                      style={{ height: "18px", background: "hsla(48, 100%, 50%, 0.08)" }}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest("[data-marker-id]")) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if ((e.shiftKey || e.metaKey || e.ctrlKey) && markers && markers.length > 0) {
                          const el = timelineRef.current;
                          if (!el) return;
                          const rect = el.getBoundingClientRect();
                          const startScrollX = el.scrollLeft;
                          const startX = e.clientX - rect.left + startScrollX;
                          markerSelectStartRef.current = { x: startX, scrollLeft: startScrollX };
                          setMarkerSelectRect({ startX, endX: startX });
                          setSelectedMarkerIds(new Set());
                          const onMove = (me: MouseEvent) => {
                            me.preventDefault();
                            if (!markerSelectStartRef.current || !el) return;
                            const currentX = me.clientX - rect.left + el.scrollLeft;
                            setMarkerSelectRect({ startX: markerSelectStartRef.current.x, endX: currentX });
                            const left = Math.min(markerSelectStartRef.current.x, currentX);
                            const right = Math.max(markerSelectStartRef.current.x, currentX);
                            const selected = new Set<string>();
                            for (const m of (markers || [])) {
                              const mx = timeToPixels(m.time);
                              if (mx >= left && mx <= right) selected.add(m.id);
                            }
                            setSelectedMarkerIds(selected);
                          };
                          const onUp = () => {
                            markerSelectStartRef.current = null;
                            setMarkerSelectRect(null);
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", onUp);
                          };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                          return;
                        }
                        setSelectedMarkerIds(new Set());
                        rulerDraggingRef.current = true;
                        seekFromEvent(e);
                        const onMove = (me: MouseEvent) => { me.preventDefault(); seekFromEvent(me); };
                        const onUp = () => { rulerDraggingRef.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                    />
                    {markers && markers.length > 0 && (
                      <div className="absolute left-0 right-0 top-0 z-30" style={{ height: "18px", pointerEvents: "none" }}>
                        {markers.map(m => {
                          const x = timeToPixels(m.time);
                          const isSelected = selectedMarkerIds.has(m.id);
                          return (
                            <div
                              key={m.id}
                              data-marker-id={m.id}
                              className="absolute cursor-grab active:cursor-grabbing"
                              style={{
                                left: `${x - 5}px`,
                                top: 0,
                                width: "11px",
                                height: "18px",
                                pointerEvents: "auto",
                                zIndex: 35,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "flex-start",
                              }}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const remaining = (markers || []).filter(mk => mk.id !== m.id);
                                onMarkersChangeRef.current?.(remaining);
                                setSelectedMarkerIds(prev => {
                                  const next = new Set(prev);
                                  next.delete(m.id);
                                  return next;
                                });
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const startX = e.clientX;
                                let dragged = false;
                                markerDragRef.current = { id: m.id, origTime: m.time, startX };
                                const el = timelineRef.current;
                                if (!el) return;
                                const onMove = (me: MouseEvent) => {
                                  me.preventDefault();
                                  if (!markerDragRef.current || !el) return;
                                  const dx = me.clientX - markerDragRef.current.startX;
                                  if (!dragged && Math.abs(dx) < 3) return;
                                  dragged = true;
                                  const newTime = Math.max(0, markerDragRef.current.origTime + pixelsToTime(dx));
                                  const snapped = snapToBeat(newTime, true);
                                  const updated = (markers || []).map(mk => mk.id === markerDragRef.current!.id ? { ...mk, time: snapped } : mk);
                                  onMarkersChangeRef.current?.(updated);
                                };
                                const onUp = () => {
                                  if (!dragged) {
                                    if (e.shiftKey) {
                                      setSelectedMarkerIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(m.id)) next.delete(m.id);
                                        else next.add(m.id);
                                        return next;
                                      });
                                    } else {
                                      setSelectedMarkerIds(prev => prev.has(m.id) && prev.size === 1 ? new Set() : new Set([m.id]));
                                    }
                                  }
                                  markerDragRef.current = null;
                                  window.removeEventListener("mousemove", onMove);
                                  window.removeEventListener("mouseup", onUp);
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                              }}
                            >
                              <span style={{
                                fontSize: "10px",
                                lineHeight: 1,
                                color: isSelected ? "hsl(0 0% 100%)" : "hsl(0 70% 55%)",
                                userSelect: "none",
                              }}>▼</span>
                              <div style={{
                                width: isSelected ? "2px" : "1px",
                                flex: 1,
                                backgroundColor: isSelected ? "hsl(0 0% 100%)" : "hsl(0 60% 45%)",
                                opacity: isSelected ? 1 : 0.7,
                              }} />
                            </div>
                          );
                        })}
                        {markerSelectRect && (() => {
                          const left = Math.min(markerSelectRect.startX, markerSelectRect.endX);
                          const width = Math.abs(markerSelectRect.endX - markerSelectRect.startX);
                          return (
                            <div
                              className="absolute top-0 bottom-0"
                              style={{
                                left: `${left}px`,
                                width: `${width}px`,
                                backgroundColor: "hsl(0 80% 50% / 0.15)",
                                border: "1px solid hsl(0 80% 50% / 0.4)",
                                pointerEvents: "none",
                              }}
                            />
                          );
                        })()}
                      </div>
                    )}
                    <div className="absolute inset-0 pointer-events-none">
                      {tickMarks}
                    </div>
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ zIndex: 1 }}
                    >
                      {bpmGridLines}
                    </div>
                    {audioTrimStart > 0 && (
                      <>
                        <div
                          className="absolute top-0 bottom-0 bg-red-900/30 pointer-events-none z-10"
                          style={{ left: 0, width: `${timeToPixels(audioTrimStart)}px` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-0.5 z-15 pointer-events-none"
                          style={{ left: `${timeToPixels(audioTrimStart)}px`, backgroundColor: "hsl(0 0% 38%)" }}
                        >
                          <span className="absolute top-0 left-1 text-[8px] font-mono whitespace-nowrap" style={{ color: "hsl(0 0% 55%)" }}>TRIM</span>
                        </div>
                      </>
                    )}
                    <div
                      className="absolute left-0 right-0"
                      style={{ top: "18px" }}
                      onMouseMove={fadeMode ? (e) => {
                        const target = e.target as HTMLElement;
                        if (!target.closest("[data-block]")) {
                          setGlobalFadeCursor("in");
                        }
                      } : undefined}
                    >
                      {timelineBlocks}
                      <div
                        ref={recLiveBlockRef}
                        className="absolute rounded-sm pointer-events-none"
                        style={{
                          display: "none",
                          top: "0px",
                          height: `${LANE_HEIGHT}px`,
                          background: "linear-gradient(90deg, hsl(0 70% 50% / 0.7), hsl(0 80% 55% / 0.9))",
                          border: "1px solid hsl(0 80% 60%)",
                          boxShadow: "0 0 8px hsl(0 80% 50% / 0.5), inset 0 0 6px hsl(0 60% 70% / 0.3)",
                          zIndex: 20,
                        }}
                      >
                        <div className="absolute inset-0 rounded-sm overflow-hidden">
                          <div
                            className="absolute inset-0"
                            style={{
                              background: "repeating-linear-gradient(90deg, transparent, transparent 6px, hsl(0 60% 65% / 0.2) 6px, hsl(0 60% 65% / 0.2) 12px)",
                              animation: "recStripe 0.6s linear infinite",
                            }}
                          />
                        </div>
                        <span className="relative z-10 text-[9px] font-bold px-1.5 leading-none flex items-center h-full" style={{ color: "hsl(0 0% 100%)", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>● REC</span>
                      </div>
                    </div>

                    {(() => {
                      const inPx = effectiveCreditIn !== null ? timeToPixels(effectiveCreditIn) : null;
                      const outPx = effectiveCreditOut !== null ? timeToPixels(effectiveCreditOut) : null;
                      return (
                        <>
                          {inPx !== null && (() => {
                            const currentAnimDur = localAnimDur ?? rawCreditAnimDur;
                            const currentHoldMs = latestLocalHoldStartMs.current ?? effectiveHoldStartMs;
                            const currentWipeMs = localWipeStartMs ?? effectiveWipeStartMs;
                            const holdStartSec = currentHoldMs / 1000;
                            const wipeStartSec = currentWipeMs / 1000;
                            const titleBEndMs = calcBarEndMs(currentAnimDur, currentWipeMs);
                            const barEndPx = timeToPixels(effectiveCreditIn! + titleBEndMs / 1000);
                            const wipeSplitPx = timeToPixels(effectiveCreditIn! + wipeStartSec);
                            const holdSplitPx = timeToPixels(effectiveCreditIn! + holdStartSec);
                            const title1Width = Math.max(0, holdSplitPx - inPx);
                            const holdWidth = Math.max(0, wipeSplitPx - holdSplitPx);
                            const title2Width = barEndPx - wipeSplitPx;
                            const barEndAbsPx = inPx + (barEndPx - inPx);
                            return (barEndPx - inPx) > 0 ? (
                              <>
                                {title1Width > 0 && (
                                  <>
                                  <div
                                    className="absolute z-10 flex items-center overflow-hidden pointer-events-none"
                                    data-testid="credit-range-bar"
                                    style={{
                                      left: `${inPx}px`,
                                      top: "0px",
                                      width: `${title1Width}px`,
                                      height: "18px",
                                      backgroundColor: creditBarSelected
                                        ? "hsl(48 100% 42%)"
                                        : "hsl(48 90% 35%)",
                                      border: creditBarSelected
                                        ? "2px solid hsl(48 100% 55%)"
                                        : "1px solid hsl(48 100% 45%)",
                                      borderRadius: "2px 0 0 2px",
                                      boxShadow: creditBarSelected ? "0 0 8px hsla(48 100% 50% / 0.6)" : "none",
                                    }}
                                  >
                                    <span className="text-[9px] font-mono font-black whitespace-nowrap px-1.5" style={{ color: "hsl(0 0% 5%)", WebkitTextStroke: "0.3px hsl(0 0% 5%)" }}>TITLE A</span>
                                  </div>
                                  <div
                                    className="absolute z-[25]"
                                    data-testid="credit-drag-handle"
                                    style={{
                                      left: `${inPx}px`,
                                      top: "0px",
                                      width: "14px",
                                      height: "18px",
                                      cursor: creditDrag ? "grabbing" : "grab",
                                    }}
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      creditDragMoved.current = false;
                                      creditDragStartX.current = e.clientX;
                                      setCreditDrag({ edge: "in", origTime: effectiveCreditIn });
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (creditDragMoved.current) return;
                                      setCreditBarSelected(prev => !prev);
                                      setSelectedIds(new Set());
                                    }}
                                  />
                                  </>
                                )}
                                <div
                                  className="absolute z-30"
                                  data-hold-start-handle
                                  style={{
                                    left: `${holdSplitPx - 6}px`,
                                    top: "0px",
                                    width: "12px",
                                    height: "18px",
                                    cursor: "ew-resize",
                                  }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    holdStartDragStartX.current = e.clientX;
                                    holdStartDragOrigMs.current = currentHoldMs;
                                    holdStartDragOrigWipeMs.current = currentWipeMs;
                                    holdStartDragOrigAnimDur.current = currentAnimDur;
                                    setIsHoldStartDrag(true);
                                  }}
                                  data-testid="hold-start-handle"
                                />
                                {holdWidth > 0 && (
                                  <div
                                    className="absolute z-10 flex items-center overflow-hidden pointer-events-none"
                                    data-testid="hold-bar"
                                    style={{
                                      left: `${holdSplitPx}px`,
                                      top: "0px",
                                      width: `${holdWidth}px`,
                                      height: "18px",
                                      backgroundColor: creditBarSelected
                                        ? "hsl(0 0% 12%)"
                                        : "hsl(0 0% 8%)",
                                      border: creditBarSelected
                                        ? "2px solid hsl(48 100% 50%)"
                                        : "1px solid hsl(48 80% 35%)",
                                      borderRadius: "0",
                                      boxShadow: creditBarSelected ? "0 0 8px hsla(48 100% 50% / 0.6)" : "none",
                                    }}
                                  >
                                    <span className="text-[9px] font-mono font-black whitespace-nowrap px-1.5" style={{ color: "hsl(0 0% 100%)", WebkitTextStroke: "0.3px hsl(0 0% 100%)", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>HOLD</span>
                                  </div>
                                )}
                                <div
                                  className="absolute z-30"
                                  data-wipe-start-handle
                                  style={{
                                    left: `${wipeSplitPx - 6}px`,
                                    top: "0px",
                                    width: "12px",
                                    height: "18px",
                                    cursor: "ew-resize",
                                  }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    wipeStartDragStartX.current = e.clientX;
                                    wipeStartDragOrigMs.current = currentWipeMs;
                                    wipeStartDragOrigAnimDur.current = currentAnimDur;
                                    setIsWipeStartDrag(true);
                                  }}
                                  data-testid="wipe-start-handle"
                                />
                                {title2Width > 0 && (
                                  <div
                                    className="absolute z-10 flex items-center overflow-hidden pointer-events-none"
                                    data-testid="title2-wipe-bar"
                                    style={{
                                      left: `${wipeSplitPx}px`,
                                      top: "0px",
                                      width: `${title2Width}px`,
                                      height: "18px",
                                      backgroundColor: creditBarSelected
                                        ? "hsl(48 100% 42%)"
                                        : "hsl(48 90% 35%)",
                                      border: creditBarSelected
                                        ? "2px solid hsl(48 100% 55%)"
                                        : "1px solid hsl(48 100% 45%)",
                                      borderRadius: "0 2px 2px 0",
                                      boxShadow: creditBarSelected ? "0 0 8px hsla(48 100% 50% / 0.6)" : "none",
                                    }}
                                  >
                                    <span className="text-[9px] font-mono font-black whitespace-nowrap px-1.5" style={{ color: "hsl(0 0% 5%)", WebkitTextStroke: "0.3px hsl(0 0% 5%)" }}>TITLE B</span>
                                  </div>
                                )}
                                <div
                                  className="absolute z-30"
                                  data-credit-anim-handle
                                  style={{
                                    left: `${barEndAbsPx - 8}px`,
                                    top: "-2px",
                                    width: "18px",
                                    height: "22px",
                                    cursor: isAnimDurDrag ? "grabbing" : "ew-resize",
                                  }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    animDurDragStartX.current = e.clientX;
                                    animDurDragOrigDur.current = currentAnimDur;
                                    setIsAnimDurDrag(true);
                                  }}
                                  data-testid="credit-anim-dur-handle"
                                />
                              </>
                            ) : null;
                          })()}
                          {inPx !== null && (
                            <div
                              className="absolute cursor-col-resize z-20"
                              style={{
                                left: `${inPx - 1}px`,
                                top: "0px",
                                width: "42px",
                                height: `${blocksZoneH}px`,
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                creditDragStartX.current = e.clientX;
                                setCreditDrag({ edge: "in", origTime: effectiveCreditIn });
                              }}
                              data-testid="credit-in-handle"
                            >
                              <div
                                className="absolute"
                                style={{
                                  left: "0px",
                                  top: "0px",
                                  width: "2px",
                                  height: `${blocksZoneH}px`,
                                  backgroundColor: "hsl(48 100% 50%)",
                                  opacity: 0.85,
                                }}
                              />
                            </div>
                          )}

                          {outPx !== null && (() => {
                            const currentAnimDur = localAnimDur ?? effectiveCreditAnimDur;
                            const animScale = currentAnimDur / DEFAULT_CREDIT_ANIM_MS;
                            const outEffectDurSec = 1.5 * animScale;
                            const outEndTime = (effectiveCreditOut ?? 0) + outEffectDurSec;
                            const outEndPx = timeToPixels(outEndTime);
                            const outBarWidth = Math.max(0, outEndPx - outPx);

                            return (
                              <>
                                {outBarWidth > 0 && (
                                  <div
                                    className="absolute z-10 flex items-center justify-end pointer-events-none overflow-hidden"
                                    data-testid="credit-out-range-bar"
                                    style={{
                                      left: `${outPx}px`,
                                      top: "0px",
                                      width: `${outBarWidth}px`,
                                      height: "18px",
                                      backgroundColor: "hsl(48 80% 28%)",
                                      border: "1px solid hsl(48 90% 40%)",
                                      borderRadius: "2px",
                                      willChange: "transform, width, left",
                                      transform: "translateZ(0)",
                                    }}
                                  >
                                    <span className="text-[9px] font-mono font-black whitespace-nowrap px-1.5" style={{ color: "hsl(0 0% 100%)", WebkitTextStroke: "0.3px hsl(0 0% 100%)", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>TITLE OUT</span>
                                  </div>
                                )}
                                <div
                                  className="absolute cursor-col-resize z-20"
                                  style={{
                                    left: `${outEndPx - 21}px`,
                                    top: "0px",
                                    width: "42px",
                                    height: `${blocksZoneH}px`,
                                    willChange: "transform, left",
                                    transform: "translateZ(0)",
                                  }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    creditDragStartX.current = e.clientX;
                                    setCreditDrag({ edge: "out", origTime: effectiveCreditOut ?? 0 });
                                  }}
                                  data-testid="credit-out-handle"
                                >
                                  <div
                                    className="absolute"
                                    style={{
                                      right: "20px",
                                      top: "0px",
                                      width: "2px",
                                      height: `${blocksZoneH}px`,
                                      backgroundColor: "hsl(48 100% 50%)",
                                      opacity: 0.85,
                                    }}
                                  />
                                </div>
                              </>
                            );
                          })()}
                        </>
                      );
                    })()}
                  </div>

                  {waveformPeaks && (
                    <>
                      <div
                        className="absolute left-0 right-0"
                        style={{
                          top: `${blocksZoneH}px`,
                          height: `${TRACK_GAP}px`,
                          backgroundColor: "hsl(0 0% 7%)",
                        }}
                      />
                      <div
                        className="absolute left-0 right-0"
                        style={{
                          top: `${blocksZoneH + TRACK_GAP + SECTION_BAND_H}px`,
                          height: `${WAVE_H}px`,
                          backgroundColor: "hsl(0 0% 7%)",
                        }}
                      >
                        <canvas
                          ref={waveformCanvasRef}
                          className="pointer-events-none"
                          style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
                          data-testid="canvas-waveform"
                        />
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{ zIndex: 2 }}
                        >
                          {bpmGridLines}
                        </div>
                      </div>
                    </>
                  )}

                  {(dropPreviewX !== null || creditDragPreviewX !== null) && (() => {
                    const px = dropPreviewX ?? creditDragPreviewX!;
                    const isLyricDrop = dropPreviewX !== null;
                    const currentBpm = bpmRef.current;
                    const twoMeasureDuration = currentBpm && currentBpm > 0 ? (60 / currentBpm) * 4 * 2 : 4;
                    const blockW = isLyricDrop ? twoMeasureDuration * pixelsPerSecond : 0;
                    const dragText = isLyricDrop ? (window as any).__dragLyricText || "" : "";
                    return (
                      <div
                        className="absolute top-0 pointer-events-none"
                        style={{
                          left: `${px}px`,
                          height: `${blocksZoneH}px`,
                          zIndex: 35,
                        }}
                      >
                        {!isLyricDrop && (
                          <>
                            <div
                              className="absolute top-0 bottom-0 w-0.5"
                              style={{
                                backgroundColor: "hsl(0 0% 50%)",
                                boxShadow: "0 0 8px hsla(0, 0%, 50%, 0.5), 0 0 16px hsla(0, 0%, 50%, 0.2)",
                              }}
                            />
                            <div
                              className="absolute top-0 w-2.5 h-3 -translate-x-[4px] rounded-b-sm"
                              style={{ backgroundColor: "hsl(0 0% 50%)" }}
                            />
                          </>
                        )}
                        {isLyricDrop && blockW > 0 && (
                          <div
                            className="absolute rounded-sm overflow-hidden"
                            style={{
                              top: "20px",
                              left: 0,
                              width: `${blockW}px`,
                              height: `${LANE_HEIGHT}px`,
                              backgroundColor: "hsla(0, 0%, 40%, 0.35)",
                              border: "1px solid hsla(0, 0%, 50%, 0.6)",
                              boxShadow: "0 0 12px hsla(0, 0%, 50%, 0.2)",
                            }}
                          >
                            <span
                              className="block truncate px-1.5 leading-none"
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "hsl(0 0% 80%)",
                                lineHeight: `${LANE_HEIGHT}px`,
                              }}
                            >
                              {dragText}
                            </span>
                          </div>
                        )}
                        {!isLyricDrop && (
                          <span
                            className="absolute top-3.5 left-1.5 text-[9px] font-mono font-bold whitespace-nowrap"
                            style={{ color: "hsl(0 0% 55%)" }}
                          >
                            IN
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {rubberBand && (() => {
                    const minX = Math.min(rubberBand.startX, rubberBand.currentX);
                    const w = Math.abs(rubberBand.currentX - rubberBand.startX);
                    return (
                      <div
                        className="absolute pointer-events-none z-30"
                        style={{
                          left: `${minX}px`,
                          top: "18px",
                          width: `${w}px`,
                          height: `${blocksZoneH - 18}px`,
                          backgroundColor: "hsla(0, 0%, 56%, 0.15)",
                          border: "1px solid hsla(0, 0%, 56%, 0.5)",
                        }}
                      />
                    );
                  })()}

                  <div
                    ref={playheadTlRef}
                    className="absolute top-0 bottom-0 w-4 z-40 cursor-col-resize -translate-x-[7px]"
                    style={{ left: "0px" }}
                    data-playhead-tl
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setIsSeekDragging(true);
                    }}
                  >
                    <div className="absolute top-0" style={{ left: "1px" }}>
                      <svg width="14" height="12" viewBox="0 0 14 12">
                        <polygon points="0,0 14,0 7,12" fill="hsl(0 0% 90%)" />
                      </svg>
                    </div>
                    <div className="absolute bottom-0" style={{ left: "7.5px", top: "12px", width: "1px", backgroundColor: "hsl(0 0% 90%)" }} />
                  </div>
                </div>
              </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});
