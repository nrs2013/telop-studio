/**
 * Browser-side WebM (VP9 alpha + Opus) encoder using MediaRecorder.
 *
 * Chrome's VideoEncoder API does NOT support VP9 alpha encoding
 * (see W3C WebCodecs issue #200). MediaRecorder + canvas.captureStream()
 * DOES support VP9 alpha when the canvas has an alpha channel.
 *
 * Trade-off: MediaRecorder records in real-time (wall clock). A 3-minute
 * song takes 3 minutes to export. This is the price of running entirely
 * in the browser without server-side FFmpeg.
 *
 * Requirements: Chrome 90+ / Edge 90+. Firefox may output opaque video.
 */

/**
 * Per-frame descriptor produced by the caller's frame generator.
 * The generator is called lazily so memory use stays constant regardless of
 * clip length.
 */
export interface FrameSpec {
  /** Source canvas to capture. Will be drawn onto the recording canvas. */
  canvas: HTMLCanvasElement;
  /** Display duration in seconds. */
  duration: number;
}

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  /** Total number of frames to encode. */
  frameCount: number;
  /**
   * Lazily generates each frame. Called sequentially with i = 0..frameCount-1.
   * Return a canvas (can be the same one, redrawn each call) and that frame's
   * duration in seconds.
   */
  getFrame: (i: number) => Promise<FrameSpec> | FrameSpec;
  /** Audio source (MP3/WAV/etc — anything decodeAudioData accepts). Optional. */
  audioBlob?: Blob | null;
  audioBitrate?: number;
  /** Called with phase + 0..1 progress. */
  onProgress?: (phase: "video" | "audio" | "mux" | "finalize", pct: number) => void;
  /** Periodically called for cancellation; if it returns true, encode aborts. */
  isCancelled?: () => boolean;
}

export interface EncodeResult {
  blob: Blob;
  byteLength: number;
  videoFrames: number;
  durationSec: number;
}

/**
 * Pick the best supported MIME type for VP9 alpha + Opus.
 * Priority: VP9 with alpha → VP9 → VP8 → webm.
 */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    'video/webm;codecs="vp9,opus"',
    "video/webm;codecs=vp9,opus",
    'video/webm;codecs="vp09.00.10.08,opus"',
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) {
        console.log(`[WebMEncoder] MediaRecorder will use mimeType: ${t}`);
        return t;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Quick support probe. Called before starting the UI flow.
 */
export async function checkWebMEncoderSupport(_width: number, _height: number): Promise<{
  supported: boolean;
  details: { mediaRecorder: boolean; mimeType: string | null };
  reason?: string;
}> {
  const mediaRecorder = typeof MediaRecorder !== "undefined";
  const mimeType = mediaRecorder ? pickMimeType() : null;
  if (!mediaRecorder) {
    return {
      supported: false,
      details: { mediaRecorder: false, mimeType: null },
      reason: "このブラウザは MediaRecorder に対応していません。Chrome / Edge の最新版をお使いください。",
    };
  }
  if (!mimeType) {
    return {
      supported: false,
      details: { mediaRecorder: true, mimeType: null },
      reason: "このブラウザは VP9 / WebM エンコーディングに対応していません。",
    };
  }
  return { supported: true, details: { mediaRecorder: true, mimeType } };
}

/**
 * Encode the given frame sequence (with optional audio) to a WebM Blob
 * using MediaRecorder + canvas.captureStream().
 *
 * Records in real-time: a 3-minute clip takes 3 minutes to encode.
 */
export async function encodeWebMAlpha(opts: EncodeOptions): Promise<EncodeResult> {
  if (opts.frameCount === 0) throw new Error("フレームが0枚です");
  const {
    width, height, fps, videoBitrate, frameCount, getFrame,
    audioBlob, audioBitrate = 192_000, onProgress, isCancelled,
  } = opts;

  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error("このブラウザは VP9 WebM 書き出しに対応していません。Chrome / Edge の最新版をお使いください。");
  }

  // ── Prepare the recording canvas ──────────────────────────────────────
  // This is the canvas whose stream will be recorded. We draw each source
  // frame onto it at the right time. Alpha channel is preserved.
  const recCanvas = document.createElement("canvas");
  recCanvas.width = width;
  recCanvas.height = height;
  const recCtx = recCanvas.getContext("2d", { alpha: true });
  if (!recCtx) throw new Error("2D コンテキストを取得できませんでした");

  // captureStream(0) = manual frame requests via requestFrame(). That lets
  // us pace the capture on our own timer, which matters because getFrame()
  // can be slightly slow and we don't want the stream to sample a half-drawn
  // canvas.
  const videoStream = (recCanvas as HTMLCanvasElement & {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(0);
  const videoTrack = videoStream.getVideoTracks()[0] as MediaStreamTrack & {
    requestFrame?: () => void;
  };

  // ── Prepare audio (optional) ──────────────────────────────────────────
  // Decode the audio file, create an AudioBufferSourceNode, and route it
  // into a MediaStreamDestination. Playback starts in sync with the
  // MediaRecorder so timing lines up with the video.
  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let audioStream: MediaStream | null = null;
  let decodedAudioDuration = 0;

  if (audioBlob) {
    onProgress?.("audio", 0);
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
    const arrayBuf = await audioBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    decodedAudioDuration = decoded.duration;
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = decoded;
    const dest = audioCtx.createMediaStreamDestination();
    audioSource.connect(dest);
    audioStream = dest.stream;
    onProgress?.("audio", 1);
  }

  // Combine video + audio into one stream for MediaRecorder.
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...(audioStream ? audioStream.getAudioTracks() : []),
  ]);

  // ── Set up MediaRecorder ──────────────────────────────────────────────
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: videoBitrate,
    audioBitsPerSecond: audioBitrate,
  });

  let recorderError: Error | null = null;
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = (e: any) => {
    recorderError = new Error(`MediaRecorder error: ${e?.error?.message || e?.error || "unknown"}`);
    console.error("[WebMEncoder] MediaRecorder error:", e);
  };

  // ── Compute total duration so we know when to stop ────────────────────
  let totalDurationSec = 0;
  const frameDurations: number[] = [];
  const microsPerFrame = 1 / fps;
  // Pre-compute and clamp durations to at least one frame.
  for (let i = 0; i < frameCount; i++) {
    // We can't call getFrame() here to measure because it has side effects
    // (drawing). Instead we re-ask during playback. But we still need a
    // total estimate for progress; we'll update on the fly.
  }
  // We compute totalDurationSec progressively during playback instead.

  // ── Start recording ───────────────────────────────────────────────────
  recorder.start();
  // Give the recorder a beat to settle before we start feeding frames.
  await new Promise((r) => setTimeout(r, 50));

  // Start audio in sync with the recorder.
  if (audioSource && audioCtx) {
    try {
      await audioCtx.resume();
    } catch { /* ignore */ }
    audioSource.start(0);
  }

  // ── Drive the playback loop in real time ──────────────────────────────
  const startedAt = performance.now();
  let frameCountDone = 0;

  try {
    for (let i = 0; i < frameCount; i++) {
      if (isCancelled?.()) throw new Error("キャンセルされました");
      if (recorderError) throw recorderError;

      const f = await getFrame(i);
      // Draw source canvas onto the recording canvas (it may be a cropped view).
      // Clear first to preserve alpha from the source.
      recCtx.clearRect(0, 0, width, height);
      recCtx.drawImage(f.canvas, 0, 0, width, height);
      // Ask the stream to sample the just-drawn frame.
      videoTrack.requestFrame?.();

      const dur = Math.max(microsPerFrame, f.duration);
      totalDurationSec += dur;

      // Wait until wall clock reaches the next frame's target time.
      const targetMs = startedAt + totalDurationSec * 1000;
      const nowMs = performance.now();
      const sleepMs = targetMs - nowMs;
      if (sleepMs > 2) {
        await new Promise((r) => setTimeout(r, sleepMs));
      }

      frameCountDone++;
      if (i % 5 === 0 || i === frameCount - 1) {
        onProgress?.("video", (i + 1) / frameCount);
      }
    }
  } finally {
    // Stop audio playback if it's still running (happens if we cancelled mid-way
    // or the audio is longer than the video).
    try {
      audioSource?.stop();
    } catch { /* ignore (already stopped) */ }
  }

  onProgress?.("video", 1);

  // ── Stop recording + wait for final data ──────────────────────────────
  onProgress?.("finalize", 0.2);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error("MediaRecorder stop timeout"));
    }, 10000);
    recorder.onstop = () => {
      clearTimeout(t);
      resolve();
    };
    try {
      recorder.stop();
    } catch (e) {
      clearTimeout(t);
      reject(e);
    }
  });
  onProgress?.("finalize", 0.7);

  // Cleanup.
  try { audioCtx?.close(); } catch { /* ignore */ }
  try {
    combinedStream.getTracks().forEach((t) => t.stop());
  } catch { /* ignore */ }

  if (recorderError) throw recorderError;
  if (chunks.length === 0) throw new Error("録画データが生成されませんでした");

  const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
  onProgress?.("finalize", 1);

  return {
    blob,
    byteLength: blob.size,
    videoFrames: frameCountDone,
    durationSec: totalDurationSec || decodedAudioDuration,
  };
}
