import Mp3Worker from "@/lib/mp3EncodeWorker?worker";

export async function compressToMp3FromBuffer(
  arrayBuffer: ArrayBuffer,
  isWav: boolean,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (onProgress) onProgress(1);

  if (isWav) {
    return encodeInWorkerDirect(arrayBuffer, onProgress, signal);
  } else {
    return encodeViaDecodeApi(arrayBuffer, onProgress, signal);
  }
}

export async function compressToMp3(
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) throw new Error("変換がキャンセルされました");
  const isWav = file.type === "audio/wav" || file.type === "audio/wave" || file.type === "audio/x-wav" || file.name.toLowerCase().endsWith(".wav");
  return compressToMp3FromBuffer(arrayBuffer, isWav, onProgress, signal);
}

function encodeInWorkerDirect(
  arrayBuffer: ArrayBuffer,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Mp3Worker();
    let settled = false;

    const cleanup = () => { worker.terminate(); };

    if (signal) {
      signal.addEventListener("abort", () => {
        if (!settled) { settled = true; cleanup(); reject(new Error("変換がキャンセルされました")); }
      }, { once: true });
    }

    worker.onmessage = (e: MessageEvent) => {
      if (settled || signal?.aborted) { cleanup(); return; }
      if (e.data.type === "progress") {
        if (onProgress) onProgress(1 + Math.round(e.data.progress * 0.99));
      } else if (e.data.type === "done") {
        settled = true;
        if (onProgress) onProgress(100);
        cleanup();
        resolve(new Blob([e.data.mp3Data], { type: "audio/mpeg" }));
      } else if (e.data.type === "error") {
        settled = true; cleanup();
        reject(new Error(e.data.message || "MP3エンコードに失敗しました"));
      }
    };

    worker.onerror = (err) => {
      if (!settled) { settled = true; cleanup(); reject(new Error("MP3エンコードに失敗しました")); }
    };

    worker.postMessage({ type: "encode", audioData: arrayBuffer }, [arrayBuffer]);
  });
}

async function encodeViaDecodeApi(
  arrayBuffer: ArrayBuffer,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (onProgress) onProgress(2);

  let audioBuffer: AudioBuffer;
  try {
    const decodeCtx = new AudioContext();
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    await decodeCtx.close();
  } catch {
    throw new Error("この音声ファイル形式はデコードできませんでした");
  }

  if (signal?.aborted) throw new Error("変換がキャンセルされました");
  if (onProgress) onProgress(4);

  const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const channelData: Float32Array[] = [];
  const transferBuffers: ArrayBuffer[] = [];
  for (let c = 0; c < numChannels; c++) {
    const raw = audioBuffer.getChannelData(c);
    const copy = new Float32Array(raw.length);
    copy.set(raw);
    channelData.push(copy);
    transferBuffers.push(copy.buffer);
  }

  return new Promise<Blob>((resolve, reject) => {
    const worker = new Mp3Worker();
    let settled = false;

    const cleanup = () => { worker.terminate(); };

    if (signal) {
      signal.addEventListener("abort", () => {
        if (!settled) { settled = true; cleanup(); reject(new Error("変換がキャンセルされました")); }
      }, { once: true });
    }

    worker.onmessage = (e: MessageEvent) => {
      if (settled || signal?.aborted) { cleanup(); return; }
      if (e.data.type === "progress") {
        if (onProgress) onProgress(4 + Math.round(e.data.progress * 0.96));
      } else if (e.data.type === "done") {
        settled = true;
        if (onProgress) onProgress(100);
        cleanup();
        resolve(new Blob([e.data.mp3Data], { type: "audio/mpeg" }));
      } else if (e.data.type === "error") {
        settled = true; cleanup();
        reject(new Error(e.data.message || "MP3エンコードに失敗しました"));
      }
    };

    worker.onerror = (err) => {
      if (!settled) { settled = true; cleanup(); reject(new Error("MP3エンコードに失敗しました")); }
    };

    worker.postMessage(
      { type: "encode", audioData: new ArrayBuffer(0), channelData, sampleRate: audioBuffer.sampleRate, channels: numChannels },
      transferBuffers
    );
  });
}
