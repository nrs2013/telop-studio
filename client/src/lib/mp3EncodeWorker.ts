import lamejs from "@breezystack/lamejs";

const ctx: Worker = self as unknown as Worker;

function decodeWav(buffer: ArrayBuffer): { sampleRate: number; channels: number; samples: Int16Array[] } | null {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x52494646) return null;
  if (view.getUint32(8, false) !== 0x57415645) return null;

  let offset = 12;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let numChannels = 2;
  let dataStart = 0;
  let dataLength = 0;

  while (offset < buffer.byteLength - 8) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 0x666d7420) {
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) {
      dataStart = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }

  if (dataStart === 0 || dataLength === 0) return null;

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (bytesPerSample * numChannels));
  const channels: Int16Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(new Int16Array(totalSamples));
  }

  let pos = dataStart;
  for (let i = 0; i < totalSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      if (bitsPerSample === 16) {
        channels[c][i] = view.getInt16(pos, true);
        pos += 2;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(pos);
        const b1 = view.getUint8(pos + 1);
        const b2 = view.getInt8(pos + 2);
        const val = (b2 << 16) | (b1 << 8) | b0;
        channels[c][i] = val >> 8;
        pos += 3;
      } else if (bitsPerSample === 32) {
        const val = view.getInt32(pos, true);
        channels[c][i] = val >> 16;
        pos += 4;
      } else if (bitsPerSample === 8) {
        channels[c][i] = (view.getUint8(pos) - 128) << 8;
        pos += 1;
      } else {
        channels[c][i] = 0;
        pos += bytesPerSample;
      }
    }
  }

  return { sampleRate, channels: numChannels, samples: channels };
}

function resampleInt16(src: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const newLen = Math.ceil(src.length / ratio);
  const out = new Int16Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, src.length - 1);
    const frac = srcIdx - idx0;
    out[i] = Math.round(src[idx0] * (1 - frac) + src[idx1] * frac);
  }
  return out;
}

function mixToMono(channels: Int16Array[]): Int16Array {
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const mono = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    mono[i] = Math.round(sum / channels.length);
  }
  return mono;
}

interface EncodeRequest {
  type: "encode";
  audioData: ArrayBuffer;
  channelData?: Float32Array[];
  sampleRate?: number;
  channels?: number;
  kbps?: number;
}

ctx.onmessage = (e: MessageEvent<EncodeRequest>) => {
  if (e.data.type !== "encode") return;

  const targetRate = 44100;
  const kbps = e.data.kbps || 192;
  let monoSamples: Int16Array;

  if (e.data.audioData && e.data.audioData.byteLength > 0) {
    const wav = decodeWav(e.data.audioData);
    if (!wav) {
      ctx.postMessage({ type: "error", message: "WAVデコードに失敗しました" });
      return;
    }
    ctx.postMessage({ type: "progress", progress: 5 });

    const mono = mixToMono(wav.samples);
    monoSamples = resampleInt16(mono, wav.sampleRate, targetRate);
    ctx.postMessage({ type: "progress", progress: 10 });
  } else if (e.data.channelData && e.data.channelData.length > 0) {
    const chData = e.data.channelData;
    const srcRate = e.data.sampleRate || targetRate;

    let floatMono: Float32Array;
    if (chData.length > 1) {
      const ch0 = chData[0];
      const ch1 = chData[1];
      floatMono = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; i++) {
        floatMono[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      floatMono = chData[0];
    }

    const ratio = srcRate / targetRate;
    const newLen = srcRate !== targetRate ? Math.ceil(floatMono.length / ratio) : floatMono.length;
    monoSamples = new Int16Array(newLen);

    if (srcRate !== targetRate) {
      for (let i = 0; i < newLen; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, floatMono.length - 1);
        const frac = srcIdx - idx0;
        const val = floatMono[idx0] * (1 - frac) + floatMono[idx1] * frac;
        monoSamples[i] = Math.max(-0x8000, Math.min(0x7FFF, Math.round(val * 0x7FFF)));
      }
    } else {
      for (let i = 0; i < floatMono.length; i++) {
        const s = Math.max(-1, Math.min(1, floatMono[i]));
        monoSamples[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
      }
    }
    ctx.postMessage({ type: "progress", progress: 10 });
  } else {
    ctx.postMessage({ type: "error", message: "No audio data provided" });
    return;
  }

  const mp3Encoder = new lamejs.Mp3Encoder(1, targetRate, kbps);
  const mp3Data: Uint8Array[] = [];

  const blockSize = 1152;
  const totalBlocks = Math.ceil(monoSamples.length / blockSize);
  let blocksProcessed = 0;

  for (let i = 0; i < monoSamples.length; i += blockSize) {
    const block = monoSamples.subarray(i, Math.min(i + blockSize, monoSamples.length));
    const mp3buf = mp3Encoder.encodeBuffer(block);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
    blocksProcessed++;
    if (blocksProcessed % 200 === 0) {
      ctx.postMessage({ type: "progress", progress: 10 + Math.round((blocksProcessed / totalBlocks) * 90) });
    }
  }

  const end = mp3Encoder.flush();
  if (end.length > 0) {
    mp3Data.push(new Uint8Array(end));
  }

  let totalLen = 0;
  for (const chunk of mp3Data) totalLen += chunk.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  ctx.postMessage({ type: "done", mp3Data: result }, [result.buffer]);
};
