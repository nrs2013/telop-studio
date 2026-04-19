/**
 * Browser-side WebM (VP9 alpha + Opus) encoder.
 *
 * Replaces the server-side FFmpeg pipeline so the app can run on free static
 * hosting (Netlify) without backend video processing.
 *
 * Requirements: Chrome 94+ / Edge 94+ (WebCodecs API).
 * Firefox WebCodecs support is partial — encoding may fail there.
 */

import { Muxer, ArrayBufferTarget } from "webm-muxer";

/**
 * Per-frame descriptor produced by the caller's frame generator.
 * The generator is called lazily so memory use stays constant regardless of
 * clip length.
 */
export interface FrameSpec {
  /** Source canvas to capture. Will be wrapped as a VideoFrame. */
  canvas: HTMLCanvasElement;
  /** Display duration in seconds (will be quantized to per-frame ticks). */
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
  /** 0..1 progress callback. */
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
 * Quick browser support probe. Throws (with a Japanese-friendly message) if any
 * required API is missing so callers can show a clear error before starting.
 */
export async function checkWebMEncoderSupport(width: number, height: number): Promise<{
  supported: boolean;
  details: { videoEncoder: boolean; audioEncoder: boolean; vp9Alpha: boolean; opus: boolean; triedCodec?: string; probeError?: string };
  reason?: string;
}> {
  const details: any = {
    videoEncoder: typeof VideoEncoder !== "undefined",
    audioEncoder: typeof AudioEncoder !== "undefined",
    vp9Alpha: false,
    opus: false,
  };
  if (!details.videoEncoder) {
    return { supported: false, details, reason: "このブラウザは VideoEncoder (WebCodecs) に対応していません。Chrome / Edge の最新版をお使いください。" };
  }
  if (!details.audioEncoder) {
    return { supported: false, details, reason: "このブラウザは AudioEncoder に対応していません。Chrome / Edge の最新版をお使いください。" };
  }
  // Try a sequence of VP9 codec strings. Different Chrome versions accept
  // different profile combinations for alpha; we pick the first that works.
  // VP9 codec strings: vp09.<profile>.<level>.<bitDepth>
  // Level encodes the max resolution:
  //   5.2 (52) = 1920x1080, 6.0 (60) = 4096x2304, 6.1 (61) = higher fps
  const candidates = [
    "vp09.00.61.08",
    "vp09.00.60.08",
    "vp09.00.52.08",
    "vp09.02.61.10",
    "vp09.00.51.08",
    "vp09.00.10.08",
    "vp9",
  ];
  const attempts: { codec: string; alpha: "keep" | "discard"; supported?: boolean; error?: string }[] = [];
  let lastErr: string | undefined;
  console.log(`[WebMEncoder] Probing VP9 alpha support for ${width}x${height}...`);
  for (const codec of candidates) {
    // Try with alpha first, fall back to no-alpha so we can diagnose which
    // codecs work at all for this resolution vs which only fail because of alpha.
    for (const alphaMode of ["keep", "discard"] as const) {
      try {
        const v = await VideoEncoder.isConfigSupported({
          codec,
          width, height,
          bitrate: 4_000_000, framerate: 30,
          alpha: alphaMode,
        });
        attempts.push({ codec, alpha: alphaMode, supported: !!v.supported });
        console.log(`[WebMEncoder]  ${codec} alpha=${alphaMode}: ${v.supported ? "✓ supported" : "✗ rejected"}`);
        if (alphaMode === "keep" && v.supported) {
          details.vp9Alpha = true;
          details.triedCodec = codec;
          break;
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        attempts.push({ codec, alpha: alphaMode, error: msg });
        console.log(`[WebMEncoder]  ${codec} alpha=${alphaMode}: ✗ threw ${msg}`);
        lastErr = msg;
      }
    }
    if (details.vp9Alpha) break;
  }
  (details as any).attempts = attempts;
  if (!details.vp9Alpha && lastErr) details.probeError = lastErr;
  try {
    const a = await AudioEncoder.isConfigSupported({
      codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000,
    });
    details.opus = !!a.supported;
  } catch { /* ignore */ }
  if (!details.vp9Alpha) {
    const tryCount = attempts.length;
    const anyNoAlpha = attempts.some(a => a.alpha === "discard" && a.supported);
    const hint = anyNoAlpha
      ? "(VP9自体は動きますがalpha未対応。ブラウザまたはOSのハードウェアエンコーダーが alpha をサポートしていません。)"
      : "(VP9 自体が動きません。DevToolsのConsoleの [WebMEncoder] ログをご確認ください。)";
    const diag = `${width}x${height}, ${tryCount}個のコーデックを試行, 最新エラー: ${details.probeError || "なし"}`;
    return { supported: false, details, reason: `VP9 (alpha) エンコードがブラウザでサポートされていません。 ${hint} [${diag}]` };
  }
  if (!details.opus) {
    return { supported: false, details, reason: "Opus 音声エンコードがブラウザでサポートされていません。" };
  }
  return { supported: true, details };
}

/**
 * Encode the given frame sequence (with optional audio) to a WebM Blob.
 *
 * Each EncodeFrame is held on screen for `duration` seconds. The function
 * computes per-frame timestamps so the resulting WebM matches the original
 * timing exactly.
 */
export async function encodeWebMAlpha(opts: EncodeOptions): Promise<EncodeResult> {
  if (opts.frameCount === 0) throw new Error("フレームが0枚です");
  const { width, height, fps, videoBitrate, frameCount, getFrame, audioBlob, audioBitrate = 192_000, onProgress, isCancelled } = opts;

  // Re-probe to find a working codec string (same logic as checkWebMEncoderSupport).
  const codecCandidates = [
    "vp09.00.10.08",
    "vp09.00.51.08",
    "vp09.00.41.08",
    "vp09.00.31.08",
    "vp09.00.10.08.01.01.01.01.00",
    "vp9",
  ];
  let workingCodec: string | null = null;
  let lastProbe: any = null;
  for (const codec of codecCandidates) {
    try {
      const v = await VideoEncoder.isConfigSupported({
        codec, width, height,
        bitrate: videoBitrate, framerate: fps,
        alpha: "keep",
      });
      lastProbe = v;
      if (v.supported) { workingCodec = codec; break; }
    } catch { /* try next */ }
  }
  if (!workingCodec) {
    throw new Error(`ブラウザが VP9 Alpha エンコードを受け付けませんでした (${width}x${height} @ ${fps}fps, bitrate=${videoBitrate}). 出力サイズやFPSを変更してお試しください。`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "V_VP9",
      width, height,
      frameRate: fps,
      alpha: true,
    },
    audio: audioBlob ? {
      codec: "A_OPUS",
      sampleRate: 48000,
      numberOfChannels: 2,
    } : undefined,
  });

  // ── Video encoder ────────────────────────────────────────────────────────
  let videoChunkCount = 0;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      videoChunkCount++;
    },
    error: (e) => { throw e; },
  });
  videoEncoder.configure({
    codec: workingCodec,
    width, height,
    bitrate: videoBitrate,
    framerate: fps,
    alpha: "keep",
    latencyMode: "quality",
  });
  console.log(`[WebMEncoder] Using codec=${workingCodec} at ${width}x${height}@${fps}fps, bitrate=${videoBitrate}`);

  // We compose our own timestamps because each frame can have arbitrary
  // duration. timestamps must be monotonic & in microseconds.
  let cursorMicro = 0;
  const microsPerFrame = Math.round(1_000_000 / fps);
  let totalDurationSec = 0;
  let lastKeyframeMicro = -Infinity; // force first frame to be a keyframe

  for (let i = 0; i < frameCount; i++) {
    if (isCancelled?.()) {
      try { videoEncoder.close(); } catch { /* ignore */ }
      throw new Error("キャンセルされました");
    }
    const f = await getFrame(i);
    const durationMicro = Math.max(microsPerFrame, Math.round(f.duration * 1_000_000));
    const vf = new VideoFrame(f.canvas, {
      timestamp: cursorMicro,
      duration: durationMicro,
      alpha: "keep",
    });
    // Force a keyframe every ~1 second to keep seeking responsive.
    const keyFrame = (cursorMicro - lastKeyframeMicro) >= 1_000_000;
    if (keyFrame) lastKeyframeMicro = cursorMicro;
    videoEncoder.encode(vf, { keyFrame });
    vf.close();
    cursorMicro += durationMicro;
    totalDurationSec = cursorMicro / 1_000_000;

    // Throttle progress + yield. Also throttle the encoder when it gets backed up
    // so we don't overflow the encoder's internal queue on long clips.
    if (i % 10 === 0) {
      onProgress?.("video", (i + 1) / frameCount);
      while (videoEncoder.encodeQueueSize > 30) {
        await new Promise((r) => setTimeout(r, 16));
        if (isCancelled?.()) {
          try { videoEncoder.close(); } catch { /* ignore */ }
          throw new Error("キャンセルされました");
        }
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();
  onProgress?.("video", 1);

  // ── Audio encoder (optional) ────────────────────────────────────────────
  if (audioBlob) {
    if (isCancelled?.()) throw new Error("キャンセルされました");
    onProgress?.("audio", 0);

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
    const arrayBuf = await audioBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));

    // Trim audio to match video duration so the file isn't bloated by trailing silence.
    const targetSamples = Math.min(decoded.length, Math.floor(totalDurationSec * decoded.sampleRate));
    const channelCount = Math.min(2, decoded.numberOfChannels); // downmix mono->mono, anything else -> stereo
    const sampleRate = decoded.sampleRate;

    let audioChunkCount = 0;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
        audioChunkCount++;
      },
      error: (e) => { throw e; },
    });
    audioEncoder.configure({
      codec: "opus",
      sampleRate,
      numberOfChannels: channelCount,
      bitrate: audioBitrate,
    });

    // Push audio in ~20ms chunks (matches Opus internal frame size, gives smooth progress).
    const chunkSamples = Math.floor(sampleRate * 0.02);
    let written = 0;
    while (written < targetSamples) {
      if (isCancelled?.()) {
        try { audioEncoder.close(); } catch { /* ignore */ }
        throw new Error("キャンセルされました");
      }
      const len = Math.min(chunkSamples, targetSamples - written);
      // Interleave channels into a single Float32Array (AudioData "f32" format).
      const interleaved = new Float32Array(len * channelCount);
      for (let ch = 0; ch < channelCount; ch++) {
        // If source is mono and we asked for stereo, channelCount==1 above already.
        const srcCh = ch < decoded.numberOfChannels ? ch : 0;
        const data = decoded.getChannelData(srcCh);
        for (let s = 0; s < len; s++) {
          interleaved[s * channelCount + ch] = data[written + s];
        }
      }
      const audioData = new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: len,
        numberOfChannels: channelCount,
        timestamp: Math.round((written / sampleRate) * 1_000_000),
        data: interleaved,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      written += len;
      if ((written / chunkSamples) % 25 === 0) {
        onProgress?.("audio", written / targetSamples);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await audioEncoder.flush();
    audioEncoder.close();
    try { await audioCtx.close(); } catch { /* ignore */ }
    onProgress?.("audio", 1);
  }

  // ── Finalize ─────────────────────────────────────────────────────────────
  onProgress?.("finalize", 0.5);
  muxer.finalize();
  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  const blob = new Blob([buffer], { type: "video/webm" });
  onProgress?.("finalize", 1);

  return {
    blob,
    byteLength: buffer.byteLength,
    videoFrames: videoChunkCount,
    durationSec: totalDurationSec,
  };
}

