export async function detectBPM(audioUrl: string): Promise<number | null> {
  try {
    const res = await fetch(audioUrl);
    const arrayBuffer = await res.arrayBuffer();
    const offlineCtx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await offlineCtx.decodeAudioData(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const mono = mixToMono(buffer);
    return detectBPMFromSamples(mono, sampleRate);
  } catch (e) {
    console.warn("BPM detection failed:", e);
    return null;
  }
}

export function detectBPMFromSamples(channelData: Float32Array, sampleRate: number): number | null {
  try {
    const targetRate = 11025;
    const ratio = Math.max(1, Math.floor(sampleRate / targetRate));
    const effectiveRate = sampleRate / ratio;

    const maxSec = 45;
    const maxSamples = Math.min(channelData.length, sampleRate * maxSec);
    const dsLen = Math.floor(maxSamples / ratio);
    const ds = new Float32Array(dsLen);
    for (let i = 0; i < dsLen; i++) {
      let sum = 0;
      const base = i * ratio;
      for (let j = 0; j < ratio && base + j < channelData.length; j++) {
        sum += channelData[base + j];
      }
      ds[i] = sum / ratio;
    }

    const hopSize = 128;
    const fftSize = 2048;

    const onsetFull = computeOnsetEnvelope(ds, effectiveRate, fftSize, hopSize);
    if (onsetFull.length < 300) return null;

    const onsetBass = computeBandOnsetEnvelope(ds, effectiveRate, fftSize, hopSize, 0, 200);
    const onsetMid = computeBandOnsetEnvelope(ds, effectiveRate, fftSize, hopSize, 200, 2000);

    const framesPerSec = effectiveRate / hopSize;

    const sectionLen = Math.floor(framesPerSec * 15);
    const sections: Float32Array[] = [];
    const bassSections: Float32Array[] = [];
    if (onsetFull.length > sectionLen * 2) {
      const mid = Math.floor(onsetFull.length / 2);
      sections.push(onsetFull.subarray(0, Math.min(sectionLen, onsetFull.length)));
      sections.push(onsetFull.subarray(Math.max(0, mid - Math.floor(sectionLen / 2)), Math.min(onsetFull.length, mid + Math.floor(sectionLen / 2))));
      sections.push(onsetFull.subarray(Math.max(0, onsetFull.length - sectionLen)));
      if (onsetBass.length > sectionLen) {
        bassSections.push(onsetBass.subarray(0, Math.min(sectionLen, onsetBass.length)));
        bassSections.push(onsetBass.subarray(Math.max(0, mid - Math.floor(sectionLen / 2)), Math.min(onsetBass.length, mid + Math.floor(sectionLen / 2))));
      }
    } else {
      sections.push(onsetFull);
      if (onsetBass.length > 100) bassSections.push(onsetBass);
    }

    const allCandidates: BPMCandidate[] = [];

    for (const section of sections) {
      const acf = autocorrelationBPM(section, framesPerSec);
      const comb = combFilterBPM(section, framesPerSec);
      const interval = onsetIntervalBPM(section, framesPerSec);
      allCandidates.push(...acf, ...comb, ...interval);
    }

    for (const section of bassSections) {
      const acf = autocorrelationBPM(section, framesPerSec);
      const comb = combFilterBPM(section, framesPerSec);
      for (const c of acf) c.score *= 1.3;
      for (const c of comb) c.score *= 1.3;
      allCandidates.push(...acf, ...comb);
    }

    if (onsetMid.length > 200) {
      const midComb = combFilterBPM(onsetMid, framesPerSec);
      allCandidates.push(...midComb);
    }

    const acfFull = autocorrelationBPM(onsetFull, framesPerSec);
    const combFull = combFilterBPM(onsetFull, framesPerSec);
    const intervalFull = onsetIntervalBPM(onsetFull, framesPerSec);
    for (const c of acfFull) c.score *= 1.5;
    for (const c of combFull) c.score *= 1.8;
    for (const c of intervalFull) c.score *= 1.2;
    allCandidates.push(...acfFull, ...combFull, ...intervalFull);

    if (allCandidates.length === 0) return null;

    const merged = mergeCandidates(allCandidates);
    const result = resolveOctaveErrors(merged);
    console.log("[BPM Detect v2] Top candidates:", merged.sort((a,b) => b.score - a.score).slice(0, 10).map(c => `${Math.round(c.bpm)}(${c.score.toFixed(2)})`).join(", "));
    console.log("[BPM Detect v2] Final BPM:", result);
    return result;
  } catch (e) {
    console.warn("BPM detection failed:", e);
    return null;
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) {
    mono[i] = (ch0[i] + ch1[i]) * 0.5;
  }
  return mono;
}

function computeOnsetEnvelope(data: Float32Array, sampleRate: number, fftSize: number, hopSize: number): Float32Array {
  const numFrames = Math.floor((data.length - fftSize) / hopSize);
  if (numFrames < 2) return new Float32Array(0);

  const halfFFT = fftSize / 2;
  let prevMag = new Float32Array(halfFFT);
  const flux = new Float32Array(numFrames);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = data[offset + i] * window[i];
    }
    fftInPlace(real, imag);

    const mag = new Float32Array(halfFFT);
    for (let i = 0; i < halfFFT; i++) {
      mag[i] = Math.log1p(Math.sqrt(real[i] * real[i] + imag[i] * imag[i]));
    }

    let sf = 0;
    for (let i = 0; i < halfFFT; i++) {
      const diff = mag[i] - prevMag[i];
      if (diff > 0) sf += diff * diff;
    }
    flux[f] = Math.sqrt(sf);
    prevMag = mag;
  }

  return adaptiveThreshold(flux, numFrames);
}

function computeBandOnsetEnvelope(data: Float32Array, sampleRate: number, fftSize: number, hopSize: number, freqLo: number, freqHi: number): Float32Array {
  const numFrames = Math.floor((data.length - fftSize) / hopSize);
  if (numFrames < 2) return new Float32Array(0);

  const halfFFT = fftSize / 2;
  const binLo = Math.max(1, Math.floor(freqLo * fftSize / sampleRate));
  const binHi = Math.min(halfFFT - 1, Math.ceil(freqHi * fftSize / sampleRate));

  let prevMag = new Float32Array(halfFFT);
  const flux = new Float32Array(numFrames);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = data[offset + i] * window[i];
    }
    fftInPlace(real, imag);

    const mag = new Float32Array(halfFFT);
    for (let i = 0; i < halfFFT; i++) {
      mag[i] = Math.log1p(Math.sqrt(real[i] * real[i] + imag[i] * imag[i]));
    }

    let sf = 0;
    for (let i = binLo; i <= binHi; i++) {
      const diff = mag[i] - prevMag[i];
      if (diff > 0) sf += diff * diff;
    }
    flux[f] = Math.sqrt(sf);
    prevMag = mag;
  }

  return adaptiveThreshold(flux, numFrames);
}

function adaptiveThreshold(flux: Float32Array, numFrames: number): Float32Array {
  const medianWin = 16;
  const lambda = 1.5;
  const normalized = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const start = Math.max(0, i - medianWin);
    const end = Math.min(numFrames, i + medianWin + 1);
    const seg: number[] = [];
    for (let j = start; j < end; j++) seg.push(flux[j]);
    seg.sort((a, b) => a - b);
    const med = seg[Math.floor(seg.length / 2)];
    let mean = 0;
    for (let j = start; j < end; j++) mean += flux[j];
    mean /= (end - start);
    const threshold = med + lambda * (mean - med);
    normalized[i] = Math.max(0, flux[i] - threshold);
  }
  return normalized;
}

function fftInPlace(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  const levels = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let j = 0;
    for (let k = 0; k < levels; k++) {
      j = (j << 1) | ((i >> k) & 1);
    }
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (-2 * Math.PI) / size;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < n; i += size) {
      let curR = 1, curI = 0;
      for (let j = 0; j < half; j++) {
        const tR = curR * real[i + j + half] - curI * imag[i + j + half];
        const tI = curR * imag[i + j + half] + curI * real[i + j + half];
        real[i + j + half] = real[i + j] - tR;
        imag[i + j + half] = imag[i + j] - tI;
        real[i + j] += tR;
        imag[i + j] += tI;
        const nextR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = nextR;
      }
    }
  }
}

type BPMCandidate = { bpm: number; score: number };

function autocorrelationBPM(onset: Float32Array, framesPerSec: number): BPMCandidate[] {
  const minBPM = 50;
  const maxBPM = 220;
  const minLag = Math.floor((60 / maxBPM) * framesPerSec);
  const maxLag = Math.min(Math.floor((60 / minBPM) * framesPerSec), Math.floor(onset.length / 2));
  if (minLag >= maxLag) return [];

  const acf = new Float32Array(maxLag + 1);
  let acfMax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = onset.length - lag;
    if (n <= 0) {
      acf[lag] = 0;
      continue;
    }
    for (let i = 0; i < n; i++) {
      sum += onset[i] * onset[i + lag];
    }
    const value = sum / n;
    acf[lag] = Number.isFinite(value) ? value : 0;
    if (acf[lag] > acfMax) acfMax = acf[lag];
  }
  if (acfMax === 0 || !Number.isFinite(acfMax)) return [];

  const candidates: BPMCandidate[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1] && acf[lag] > acfMax * 0.02) {
      const peakLag = lag + parabolicInterp(acf[lag - 1], acf[lag], acf[lag + 1]);
      const bpm = (60 * framesPerSec) / peakLag;
      if (bpm >= 40 && bpm <= 240) {
        candidates.push({ bpm, score: acf[lag] / acfMax });
      }
    }
  }
  return candidates;
}

function combFilterBPM(onset: Float32Array, framesPerSec: number): BPMCandidate[] {
  const candidates: BPMCandidate[] = [];
  const pulseWeights = [1.0, 0.9, 0.7, 0.5, 0.3, 0.2, 0.1];

  for (let bpmTenths = 500; bpmTenths <= 2200; bpmTenths++) {
    const bpm = bpmTenths / 10;
    const lag = (60 * framesPerSec) / bpm;
    let energy = 0;
    let totalWeight = 0;
    for (let pulse = 1; pulse <= pulseWeights.length; pulse++) {
      const pulseLag = lag * pulse;
      if (pulseLag >= onset.length - 1) break;
      const i0 = Math.floor(pulseLag);
      const frac = pulseLag - i0;
      const i1 = i0 + 1;
      if (i1 >= onset.length) break;
      const n = onset.length - i1;
      let sum0 = 0, sum1 = 0;
      for (let i = 0; i < n; i++) {
        sum0 += onset[i] * onset[i + i0];
        sum1 += onset[i] * onset[i + i1];
      }
      const corr = ((1 - frac) * sum0 + frac * sum1) / n;
      const w = pulseWeights[pulse - 1];
      energy += corr * w;
      totalWeight += w;
    }
    if (totalWeight > 0) energy /= totalWeight;
    candidates.push({ bpm, score: energy });
  }

  let maxScore = 0;
  for (const c of candidates) {
    if (c.score > maxScore) maxScore = c.score;
  }
  if (maxScore === 0) return [];
  for (const c of candidates) c.score /= maxScore;

  const peaks: BPMCandidate[] = [];
  for (let i = 5; i < candidates.length - 5; i++) {
    const c = candidates[i];
    let isPeak = true;
    for (let d = 1; d <= 5; d++) {
      if (c.score <= candidates[i - d].score || c.score < candidates[i + d].score) {
        isPeak = false;
        break;
      }
    }
    if (isPeak && c.score > 0.06) {
      peaks.push(c);
    }
  }
  return peaks;
}

function onsetIntervalBPM(onset: Float32Array, framesPerSec: number): BPMCandidate[] {
  let maxOnset = 0;
  for (let i = 0; i < onset.length; i++) {
    if (onset[i] > maxOnset) maxOnset = onset[i];
  }
  if (maxOnset === 0) return [];

  const threshold = maxOnset * 0.08;
  const minDist = Math.floor(framesPerSec * 0.1);
  const peakIndices: number[] = [];
  const peakValues: number[] = [];
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > threshold && onset[i] > onset[i - 1] && onset[i] >= onset[i + 1]) {
      if (peakIndices.length === 0 || i - peakIndices[peakIndices.length - 1] >= minDist) {
        peakIndices.push(i);
        peakValues.push(onset[i]);
      }
    }
  }

  if (peakIndices.length < 6) return [];

  const histogram = new Map<number, number>();
  const maxPeaks = Math.min(peakIndices.length, 300);
  for (let i = 0; i < maxPeaks; i++) {
    for (let j = i + 1; j < Math.min(i + 16, maxPeaks); j++) {
      const interval = peakIndices[j] - peakIndices[i];
      let bpm = (60 * framesPerSec) / interval;
      while (bpm < 60) bpm *= 2;
      while (bpm > 220) bpm /= 2;
      const weight = (peakValues[i] + peakValues[j]) / (2 * maxOnset);
      const key = Math.round(bpm);
      histogram.set(key, (histogram.get(key) || 0) + weight);
    }
  }

  let maxCount = 0;
  for (const count of histogram.values()) {
    if (count > maxCount) maxCount = count;
  }
  if (maxCount === 0) return [];

  const candidates: BPMCandidate[] = [];
  for (const [bpm, count] of histogram) {
    if (count > maxCount * 0.08) {
      candidates.push({ bpm, score: count / maxCount });
    }
  }
  return candidates;
}

function parabolicInterp(a: number, b: number, c: number): number {
  // Guard against NaN inputs (would propagate through the calculation).
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return 0;
  const denom = 2 * (2 * b - a - c);
  if (Math.abs(denom) < 1e-10) return 0;
  return (a - c) / denom;
}

function mergeCandidates(candidates: BPMCandidate[]): BPMCandidate[] {
  const buckets = new Map<number, { totalScore: number; weightedBpm: number; count: number }>();

  for (const c of candidates) {
    const key = Math.round(c.bpm);
    let matched = false;
    for (const [k, v] of buckets) {
      if (Math.abs(k - key) <= 1) {
        v.totalScore += c.score;
        v.weightedBpm += c.bpm * c.score;
        v.count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buckets.set(key, {
        totalScore: c.score,
        weightedBpm: c.bpm * c.score,
        count: 1,
      });
    }
  }

  const result: BPMCandidate[] = [];
  for (const [, v] of buckets) {
    const bpm = v.weightedBpm / v.totalScore;
    let score = v.totalScore;
    if (v.count >= 10) score *= 1.5;
    else if (v.count >= 5) score *= 1.2;
    result.push({ bpm, score });
  }
  return result;
}

function resolveOctaveErrors(candidates: BPMCandidate[]): number {
  candidates.sort((a, b) => b.score - a.score);

  const normalized: BPMCandidate[] = candidates.map((c) => {
    let bpm = c.bpm;
    while (bpm < 70) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    return { bpm, score: c.score };
  });

  const groups = new Map<number, { totalScore: number; weightedBpm: number; count: number }>();
  for (const c of normalized) {
    const key = Math.round(c.bpm);
    let matched = false;
    for (const [k, v] of groups) {
      if (Math.abs(k - key) <= 2) {
        v.totalScore += c.score;
        v.weightedBpm += c.bpm * c.score;
        v.count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(key, { totalScore: c.score, weightedBpm: c.bpm * c.score, count: 1 });
    }
  }

  const groupEntries: { bpm: number; score: number; count: number }[] = [];
  for (const [, v] of groups) {
    const bpm = v.weightedBpm / v.totalScore;
    groupEntries.push({ bpm, score: v.totalScore, count: v.count });
  }

  for (const g of groupEntries) {
    const b = g.bpm;
    if (b >= 80 && b <= 190) g.score *= 1.1;
    if (g.count >= 8) g.score *= 1.2;
    else if (g.count >= 4) g.score *= 1.1;
  }

  for (let i = 0; i < groupEntries.length; i++) {
    for (let j = i + 1; j < groupEntries.length; j++) {
      const hi = groupEntries[i].bpm > groupEntries[j].bpm ? groupEntries[i] : groupEntries[j];
      const lo = groupEntries[i].bpm > groupEntries[j].bpm ? groupEntries[j] : groupEntries[i];
      const ratio = hi.bpm / lo.bpm;

      if (Math.abs(ratio - 2.0) < 0.06) {
        if (hi.bpm >= 80 && hi.bpm <= 200 && lo.bpm < 80) {
          lo.score *= 0.5;
        } else if (lo.bpm >= 80 && lo.bpm <= 200 && hi.bpm > 200) {
          hi.score *= 0.5;
        }
      }

      if (Math.abs(ratio - 1.5) < 0.05) {
        if (hi.score > lo.score * 0.7) {
          lo.score *= 0.6;
        } else if (lo.score > hi.score * 0.7) {
          hi.score *= 0.6;
        }
      }

      if (Math.abs(ratio - 3.0) < 0.08) {
        lo.score *= 0.4;
      }
    }
  }

  groupEntries.sort((a, b) => b.score - a.score);
  const FALLBACK_BPM = 120;
  if (groupEntries.length === 0) {
    if (normalized.length === 0) return FALLBACK_BPM;
    const fallback = normalized[0].bpm;
    return Number.isFinite(fallback) ? Math.round(fallback) : FALLBACK_BPM;
  }

  let finalBpm = groupEntries[0].bpm;
  // Defensive: handle NaN/Infinity that might bubble through earlier math.
  if (!Number.isFinite(finalBpm) || finalBpm <= 0) return FALLBACK_BPM;
  while (finalBpm < 70) finalBpm *= 2;
  while (finalBpm > 200) finalBpm /= 2;
  if (!Number.isFinite(finalBpm)) return FALLBACK_BPM;

  // --- ステージ2：キック帯域マッチで整数精度に精密化（±3 BPM を 0.25 刻みで網羅探索）---
  const rough = Math.round(finalBpm);
  const refined = refineBPMByKickMatch(channelData, sampleRate, rough);
  return refined;
}

/** 既存の検出結果（rough）から ±3 BPM の範囲を 0.25 刻みで網羅し、
 *  キックドラム帯域のエンベロープと各ビート位置の一致度でスコアリング。
 *  最も整合する整数 BPM を返す。楽曲後半でのグリッドドリフトを大幅に抑制する。 */
export function refineBPMByKickMatch(
  channelData: Float32Array,
  sampleRate: number,
  roughBpm: number
): number {
  if (!channelData || !sampleRate || !roughBpm) return roughBpm;
  const duration = channelData.length / sampleRate;
  const fsEnv = 1000;
  const dsFactor = Math.max(1, Math.floor(sampleRate / fsEnv));
  const envLen = Math.floor(channelData.length / dsFactor);
  const env = new Float32Array(envLen);
  // 区間内の最大絶対値でエンベロープ化（キック/スネアのアタックを捉える）
  for (let i = 0; i < envLen; i++) {
    let peak = 0;
    const s = i * dsFactor;
    const e = Math.min(channelData.length, s + dsFactor);
    for (let j = s; j < e; j++) {
      const v = Math.abs(channelData[j]);
      if (v > peak) peak = v;
    }
    env[i] = peak;
  }
  let bestBpm = roughBpm;
  let bestScore = -1;
  // ±3 BPM を 0.25 刻みで評価
  for (let delta = -3; delta <= 3 + 1e-9; delta += 0.25) {
    const bpm = roughBpm + delta;
    if (bpm < 40 || bpm > 300) continue;
    const secPerBeat = 60 / bpm;
    // 先頭オフセット（downbeat 候補）も網羅
    let scoreForBpm = -1;
    for (let off = 0; off < 2; off += 0.05) {
      let score = 0, count = 0;
      const maxBeats = Math.min(500, Math.floor((duration - off) / secPerBeat));
      for (let i = 0; i < maxBeats; i++) {
        const t = off + i * secPerBeat;
        const idx = Math.floor(t * fsEnv);
        if (idx >= 0 && idx < envLen) { score += env[idx]; count++; }
      }
      if (count > 20 && score > scoreForBpm) scoreForBpm = score;
    }
    if (scoreForBpm > bestScore) {
      bestScore = scoreForBpm;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm);
}
