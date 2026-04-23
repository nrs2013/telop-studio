// Two-stream VP9 + alpha WebM encoder.
//
// BACKGROUND
// ----------
// ffmpeg's libvpx / libvpx-vp9 wrapper has a long-standing bug where feeding
// it yuva420p frames produces a WebM that contains BlockAdditional elements
// with the right structure, but the VP9 bitstream inside each BlockAdditional
// encodes a completely-opaque alpha plane (Y = 255 for every pixel) — no
// matter what alpha mask is in the input. Reproduced across ffmpeg 4.4
// (Ubuntu 22.04) and 7.1.3 (Debian trixie), both using Debian-packaged
// libvpx. Also reproduced with BtbN's static build. It's not a pix_fmt
// negotiation issue; by the time the file is written, the alpha plane has
// already been silently zeroed out inside the alpha libvpx context that
// ffmpeg's wrapper spawns but doesn't configure correctly.
//
// WHAT THIS MODULE DOES
// ---------------------
// To avoid ffmpeg's broken alpha pipeline entirely, we encode the video in
// two completely independent passes, then combine them ourselves:
//
//   1. Color pass   : RGB frames → VP9 (yuv420p) → color IVF  [no alpha in sight]
//   2. Alpha pass   : the alpha channel, extracted as a grayscale image,
//                     encoded as a regular Y-only VP9 → alpha IVF
//   3. Mux          : a minimal, purpose-built EBML/WebM writer reads both
//                     IVFs and emits a single WebM where the color frame is
//                     the SimpleBlock and the alpha frame is attached to the
//                     same Block as a BlockAdditional with BlockAddID=1 —
//                     which is exactly the on-wire format Resolume Arena /
//                     Chrome / Firefox are expecting.
//
// No external muxer binaries are needed. No ffmpeg flag juggling. The alpha
// stream goes through the NORMAL VP9 encoder path (which works), so the
// known-broken alpha pipeline is completely bypassed.

import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";

// -----------------------------------------------------------------------------
// IVF (Google's raw VP9 file format) reader
// -----------------------------------------------------------------------------

type IvfFrame = {
  data: Buffer;       // raw VP9 bitstream for this frame
  pts: bigint;        // 64-bit timestamp in the IVF file's timebase
  isKeyframe: boolean;
};

type IvfFile = {
  width: number;
  height: number;
  timebaseDen: number;
  timebaseNum: number;
  frames: IvfFrame[];
};

export function parseIvf(buf: Buffer): IvfFile {
  // IVF header is 32 bytes:
  //   0-3  : 'DKIF'
  //   4-5  : version (LE)
  //   6-7  : header size (LE, typically 32)
  //   8-11 : FourCC (VP90 for VP9)
  //   12-13: width (LE)
  //   14-15: height (LE)
  //   16-19: timebase denominator (LE)
  //   20-23: timebase numerator (LE)
  //   24-27: number of frames (LE) — often 0, don't rely on it
  //   28-31: reserved
  if (buf.length < 32 || buf.slice(0, 4).toString("ascii") !== "DKIF") {
    throw new Error("Not an IVF file");
  }
  const fourcc = buf.slice(8, 12).toString("ascii");
  if (fourcc !== "VP90" && fourcc !== "VP9 ") {
    throw new Error(`IVF fourcc is '${fourcc}', expected 'VP90'`);
  }
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const timebaseDen = buf.readUInt32LE(16);
  const timebaseNum = buf.readUInt32LE(20);

  const frames: IvfFrame[] = [];
  let off = 32;
  while (off + 12 <= buf.length) {
    // Per-frame header: 4 bytes size (LE) + 8 bytes pts (LE)
    const size = buf.readUInt32LE(off);
    const pts = buf.readBigUInt64LE(off + 4);
    off += 12;
    if (off + size > buf.length) {
      throw new Error(`IVF: frame @${off} wants ${size} bytes, only ${buf.length - off} remain`);
    }
    const data = buf.slice(off, off + size);
    off += size;
    // VP9 keyframe bit: the first byte's bit layout. An uncompressed header
    // byte starts with a 2-bit frame_marker (always 0b10 = 2), then a
    // profile bit, then a show_existing_frame bit, then frame_type. For a
    // keyframe, frame_type is 0; for an inter-frame, frame_type is 1.
    // A simpler and widely-used heuristic: check bit 2 of byte 0. If 0,
    // it's a keyframe. See https://www.webmproject.org/vp9/bitstream/
    const isKeyframe = data.length > 0 && ((data[0] >> 2) & 0x01) === 0;
    frames.push({ data, pts, isKeyframe });
  }
  return { width, height, timebaseDen, timebaseNum, frames };
}

// -----------------------------------------------------------------------------
// Minimal EBML / WebM writer
// -----------------------------------------------------------------------------
//
// The WebM container is EBML — a self-describing tag/length/value format.
// Every element is: [variable-length ID][variable-length size][payload].
// The subset we need to emit:
//
//   EBML (0x1A45DFA3)
//     EBMLVersion, EBMLReadVersion, EBMLMaxIDLength, EBMLMaxSizeLength,
//     DocType='webm', DocTypeVersion, DocTypeReadVersion
//   Segment (0x18538067)
//     Info (0x1549A966)
//       TimestampScale (0x2AD7B1) = 1_000_000  (1ms per tick)
//       MuxingApp, WritingApp, Duration (0x4489)
//     Tracks (0x1654AE6B)
//       TrackEntry (0xAE)
//         TrackNumber=1, TrackUID, TrackType=1(video), CodecID='V_VP9',
//         BlockAdditionMappings? (optional but useful)
//         Video (0xE0)
//           PixelWidth, PixelHeight, AlphaMode (0x53C0) = 1
//     Cluster* (0x1F43B675)
//       Timestamp (0xE7)
//       BlockGroup (0xA0)   ← we use BlockGroup, not SimpleBlock, because
//         Block (0xA1)       BlockAdditional needs a BlockGroup wrapper.
//         BlockAdditions (0x75A1)
//           BlockMore (0xA6)
//             BlockAddID (0xEE) = 1 (reserved for alpha in WebM/Matroska)
//             BlockAdditional (0xA5) = <alpha VP9 frame bytes>
//         BlockDuration (0x9B)
//
// That's it. Anything a decoder needs to play the file falls out of that.

// Encode an unsigned integer as a Matroska VINT of minimum length.
// Matroska's "variable-length integer":
//   1 byte : 1xxxxxxx  → 7-bit value
//   2 bytes: 01xxxxxx xxxxxxxx  → 14-bit value
//   3 bytes: 001xxxxx ...       → 21-bit value
//   ...
// For simplicity we support up to 56-bit values (8 bytes, leading bit
// pattern 00000001). That's way more than any duration we'll emit.
function vint(value: bigint | number): Buffer {
  let v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("vint: negative");
  if (v < (1n << 7n) - 1n) {
    return Buffer.from([Number(0x80n | v)]);
  }
  if (v < (1n << 14n) - 1n) {
    const n = Number(v);
    return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  }
  if (v < (1n << 21n) - 1n) {
    const n = Number(v);
    return Buffer.from([0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff]);
  }
  if (v < (1n << 28n) - 1n) {
    const n = Number(v);
    return Buffer.from([0x10 | (n >> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  }
  // 5..8 byte VINTs.
  for (let byteLen = 5; byteLen <= 8; byteLen++) {
    const max = 1n << BigInt(7 * byteLen);
    if (v < max - 1n) {
      const out = Buffer.alloc(byteLen);
      const prefix = 1 << (8 - byteLen);
      const topShift = BigInt(8 * (byteLen - 1));
      out[0] = prefix | Number((v >> topShift) & 0xffn);
      for (let i = 1; i < byteLen; i++) {
        out[i] = Number((v >> BigInt(8 * (byteLen - 1 - i))) & 0xffn);
      }
      return out;
    }
  }
  throw new Error(`vint: value too large: ${v}`);
}

// Encode an EBML element ID as a raw big-endian byte sequence (its VINT form
// is just the ID bytes as given, already carrying the length marker).
function idBytes(id: number): Buffer {
  if (id < 0x100) return Buffer.from([id]);
  if (id < 0x10000) return Buffer.from([(id >> 8) & 0xff, id & 0xff]);
  if (id < 0x1000000) return Buffer.from([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  return Buffer.from([(id >>> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
}

function elem(id: number, payload: Buffer): Buffer {
  return Buffer.concat([idBytes(id), vint(payload.length), payload]);
}

// Encode a non-negative integer payload as a minimum-width big-endian byte
// sequence. Used for element values like TrackNumber, PixelWidth, etc.
function uintPayload(n: bigint | number): Buffer {
  let v = typeof n === "bigint" ? n : BigInt(n);
  if (v === 0n) return Buffer.from([0]);
  const bytes: number[] = [];
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Buffer.from(bytes);
}

function stringPayload(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

function float64Payload(x: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x, 0);
  return b;
}

// Build a Block element payload (spec §11.1.4.1):
//   [VINT TrackNumber][int16 timecode_offset_be][flags=0x00][frame bytes]
function buildBlockPayload(trackNumber: number, relTimestampMs: number, frame: Buffer): Buffer {
  if (relTimestampMs < -32768 || relTimestampMs > 32767) {
    throw new Error(`Block relTimestampMs out of int16 range: ${relTimestampMs}`);
  }
  const tn = vint(trackNumber);
  const ts = Buffer.alloc(2);
  ts.writeInt16BE(relTimestampMs, 0);
  const flags = Buffer.from([0x00]); // keyframe flag is on BlockGroup, not here
  return Buffer.concat([tn, ts, flags, frame]);
}

// -----------------------------------------------------------------------------
// Main API
// -----------------------------------------------------------------------------

export type EncodeAlphaOptions = {
  ffmpegBin?: string;
  /** Input frame pattern, printf-style (e.g. "/tmp/cfr_%06d.png"). */
  framePattern: string;
  /** Workspace for intermediates. Cleaned up on success unless keepIntermediates=true. */
  workDir: string;
  /** Output WebM path. */
  outputPath: string;
  /** Frame rate as a rational. */
  fps: number;
  /** CRF quality (0-63, lower is higher quality). */
  crf?: number;
  /** Target bitrate, if you want average-bitrate mode instead of CRF. */
  bitrate?: string; // e.g. "2M"
  /** Optional audio to mux in after video muxing. */
  audioPath?: string;
  audioBitrate?: number;
  /** Keep the intermediate color.ivf / alpha.ivf files for inspection. */
  keepIntermediates?: boolean;
  /** Optional metadata comment (for crop info, etc.). */
  comment?: string;
  /** Log line prefix for diagnostics. */
  logPrefix?: string;
};

export type EncodeAlphaResult = {
  outputPath: string;
  durationMs: number;
  colorBytes: number;
  alphaBytes: number;
  frameCount: number;
};

export async function encodeAlphaWebM(opts: EncodeAlphaOptions): Promise<EncodeAlphaResult> {
  const ffmpegBin = opts.ffmpegBin || "ffmpeg";
  const fps = opts.fps;
  const crf = opts.crf ?? 30;
  const log = (m: string) => console.log(`${opts.logPrefix || "[AlphaEnc]"} ${m}`);

  fs.mkdirSync(opts.workDir, { recursive: true });
  const colorIvf = path.join(opts.workDir, "color.ivf");
  const alphaIvf = path.join(opts.workDir, "alpha.ivf");
  const muxedVideoWebm = path.join(opts.workDir, "video_only.webm");

  // 1. Color pass. Strip alpha, encode as regular VP9 (yuv420p).
  log("color pass (libvpx-vp9, yuv420p, no alpha)…");
  const colorArgs = [
    "-y", "-hide_banner", "-nostdin", "-v", "error",
    "-framerate", String(fps),
    "-i", opts.framePattern,
    "-map", "0:v",
    "-vf", "format=yuv420p",
    "-c:v", "libvpx-vp9",
    "-auto-alt-ref", "0",
    ...(opts.bitrate ? ["-b:v", opts.bitrate] : ["-crf", String(crf), "-b:v", "0"]),
    "-deadline", "good",
    "-cpu-used", "4",
    "-threads", "2",
    "-f", "ivf",
    colorIvf,
  ];
  await runFfmpeg(ffmpegBin, colorArgs, "color encode");

  // 2. Alpha pass. Extract alpha channel as grayscale, encode as regular VP9.
  //    alphaextract gives us a gray frame where Y = source alpha; libvpx-vp9
  //    then encodes it exactly like any normal Y-only video, which works.
  log("alpha pass (libvpx-vp9 on alphaextract output)…");
  const alphaArgs = [
    "-y", "-hide_banner", "-nostdin", "-v", "error",
    "-framerate", String(fps),
    "-i", opts.framePattern,
    "-map", "0:v",
    "-vf", "alphaextract,format=yuv420p",
    "-c:v", "libvpx-vp9",
    "-auto-alt-ref", "0",
    ...(opts.bitrate ? ["-b:v", opts.bitrate] : ["-crf", String(crf), "-b:v", "0"]),
    "-deadline", "good",
    "-cpu-used", "4",
    "-threads", "2",
    "-f", "ivf",
    alphaIvf,
  ];
  await runFfmpeg(ffmpegBin, alphaArgs, "alpha encode");

  // 3. Parse both IVFs and mux into a single alpha WebM.
  log("mux: combining color + alpha into WebM with BlockAdditional…");
  const colorBuf = fs.readFileSync(colorIvf);
  const alphaBuf = fs.readFileSync(alphaIvf);
  const colorIvfFile = parseIvf(colorBuf);
  const alphaIvfFile = parseIvf(alphaBuf);

  if (colorIvfFile.frames.length !== alphaIvfFile.frames.length) {
    throw new Error(
      `color/alpha frame count mismatch: color=${colorIvfFile.frames.length} alpha=${alphaIvfFile.frames.length}`
    );
  }
  if (
    colorIvfFile.width !== alphaIvfFile.width ||
    colorIvfFile.height !== alphaIvfFile.height
  ) {
    throw new Error(
      `color/alpha size mismatch: ${colorIvfFile.width}x${colorIvfFile.height} vs ${alphaIvfFile.width}x${alphaIvfFile.height}`
    );
  }

  const webmBuf = muxAlphaWebM({
    width: colorIvfFile.width,
    height: colorIvfFile.height,
    fps,
    colorFrames: colorIvfFile.frames,
    alphaFrames: alphaIvfFile.frames,
  });
  fs.writeFileSync(muxedVideoWebm, webmBuf);

  // 4. If audio was requested, ffmpeg -c copy to add it to the final output.
  //    `-c copy` passes the video blocks through untouched, so our custom
  //    BlockAdditional structure survives.
  if (opts.audioPath && fs.existsSync(opts.audioPath)) {
    log("adding audio track via -c copy passthrough…");
    const finalArgs = [
      "-y", "-hide_banner", "-nostdin", "-v", "error",
      "-i", muxedVideoWebm,
      "-i", opts.audioPath,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy",
      "-c:a", "libopus",
      "-b:a", String(opts.audioBitrate ?? 96000),
      "-shortest",
      ...(opts.comment ? ["-metadata", `comment=${opts.comment}`] : []),
      opts.outputPath,
    ];
    await runFfmpeg(ffmpegBin, finalArgs, "audio mux");
  } else {
    // No audio — rename the muxed video to the final output path.
    fs.copyFileSync(muxedVideoWebm, opts.outputPath);
  }

  const colorBytes = fs.statSync(colorIvf).size;
  const alphaBytes = fs.statSync(alphaIvf).size;
  const frameCount = colorIvfFile.frames.length;
  const durationMs = (frameCount * 1000) / fps;
  log(
    `done: frames=${frameCount} color=${colorBytes}B alpha=${alphaBytes}B → ${opts.outputPath} (${fs.statSync(opts.outputPath).size}B)`,
  );

  if (!opts.keepIntermediates) {
    try { fs.unlinkSync(colorIvf); } catch {}
    try { fs.unlinkSync(alphaIvf); } catch {}
    try { fs.unlinkSync(muxedVideoWebm); } catch {}
  }

  return {
    outputPath: opts.outputPath,
    durationMs,
    colorBytes,
    alphaBytes,
    frameCount,
  };
}

function runFfmpeg(bin: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });
    proc.on("error", (err) => reject(new Error(`${label}: spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}: ffmpeg exited ${code}\n${stderr.split("\n").slice(-6).join("\n")}`));
    });
  });
}

// -----------------------------------------------------------------------------
// WebM muxer — color + per-frame alpha BlockAdditional
// -----------------------------------------------------------------------------

export function muxAlphaWebM(opts: {
  width: number;
  height: number;
  fps: number;
  colorFrames: IvfFrame[];
  alphaFrames: IvfFrame[];
}): Buffer {
  const { width, height, fps, colorFrames, alphaFrames } = opts;

  // --- EBML header ---
  const ebmlHeader = elem(
    0x1a45dfa3, // EBML
    Buffer.concat([
      elem(0x4286, uintPayload(1)),   // EBMLVersion
      elem(0x42f7, uintPayload(1)),   // EBMLReadVersion
      elem(0x42f2, uintPayload(4)),   // EBMLMaxIDLength
      elem(0x42f3, uintPayload(8)),   // EBMLMaxSizeLength
      elem(0x4282, stringPayload("webm")), // DocType
      elem(0x4287, uintPayload(4)),   // DocTypeVersion
      elem(0x4285, uintPayload(2)),   // DocTypeReadVersion
    ]),
  );

  // --- Info ---
  const durationMs = (colorFrames.length * 1000) / fps;
  const info = elem(
    0x1549a966,
    Buffer.concat([
      elem(0x2ad7b1, uintPayload(1_000_000)), // TimestampScale (1ms)
      elem(0x4d80, stringPayload("telop-studio alpha muxer")), // MuxingApp
      elem(0x5741, stringPayload("telop-studio alpha muxer")), // WritingApp
      elem(0x4489, float64Payload(durationMs)), // Duration
    ]),
  );

  // --- Tracks ---
  const trackEntry = elem(
    0xae,
    Buffer.concat([
      elem(0xd7, uintPayload(1)),                  // TrackNumber
      elem(0x73c5, uintPayload(1)),                // TrackUID
      elem(0x83, uintPayload(1)),                  // TrackType = video
      elem(0x9c, uintPayload(0)),                  // FlagLacing = off
      elem(0x86, stringPayload("V_VP9")),          // CodecID
      elem(0x258688, stringPayload("VP9 with alpha")), // CodecName (informational)
      elem(
        0xe0, // Video
        Buffer.concat([
          elem(0xb0, uintPayload(width)),      // PixelWidth
          elem(0xba, uintPayload(height)),     // PixelHeight
          elem(0x53c0, uintPayload(1)),        // AlphaMode = 1
        ]),
      ),
    ]),
  );
  const tracks = elem(0x1654ae6b, trackEntry);

  // --- Clusters ---
  // Keep things simple: one Cluster that contains all BlockGroups. Works
  // for short clips (< ~32s) because BlockGroup's timecode offset is an
  // int16 of milliseconds. For longer clips we'd emit multiple clusters.
  // We'll split into clusters of up to ~30_000 ms each to stay safe.
  const msPerFrame = 1000 / fps;
  const CLUSTER_WINDOW_MS = 30_000;

  const clusterParts: Buffer[] = [];
  let clusterIdx = 0;
  while (clusterIdx < colorFrames.length) {
    const clusterStartMs = Math.round(clusterIdx * msPerFrame);
    const parts: Buffer[] = [
      elem(0xe7, uintPayload(clusterStartMs)), // Timestamp
    ];
    let i = clusterIdx;
    while (i < colorFrames.length) {
      const absMs = Math.round(i * msPerFrame);
      const relMs = absMs - clusterStartMs;
      if (relMs > 32767) break; // need a new cluster
      const cf = colorFrames[i];
      const af = alphaFrames[i];

      const blockPayload = buildBlockPayload(1, relMs, cf.data);
      const block = elem(0xa1, blockPayload); // Block
      const blockDuration = elem(0x9b, uintPayload(Math.round(msPerFrame)));

      // BlockAdditions / BlockMore / BlockAddID=1 / BlockAdditional=alpha frame
      const blockMore = elem(
        0xa6,
        Buffer.concat([
          elem(0xee, uintPayload(1)),     // BlockAddID (1 = alpha per WebM spec)
          elem(0xa5, af.data),            // BlockAdditional
        ]),
      );
      const blockAdditions = elem(0x75a1, blockMore);

      // ReferenceBlock (only for non-keyframes; we omit it — libvpx keyframes
      // are frequent enough that simple playback works). This keeps muxing
      // stateless per-frame.
      const referenceBlock = cf.isKeyframe ? Buffer.alloc(0) : elem(0xfb, signedIntPayload(-Math.round(msPerFrame)));

      const blockGroup = elem(
        0xa0,
        Buffer.concat([block, blockDuration, blockAdditions, referenceBlock]),
      );
      parts.push(blockGroup);
      i++;
    }
    clusterParts.push(elem(0x1f43b675, Buffer.concat(parts)));
    clusterIdx = i;
  }

  // --- Segment (wrap Info + Tracks + Clusters) ---
  const segmentPayload = Buffer.concat([info, tracks, ...clusterParts]);
  const segment = elem(0x18538067, segmentPayload);

  return Buffer.concat([ebmlHeader, segment]);
}

function signedIntPayload(n: number): Buffer {
  // Minimum-width big-endian two's-complement.
  if (n >= -128 && n <= 127) {
    const b = Buffer.alloc(1);
    b.writeInt8(n, 0);
    return b;
  }
  if (n >= -32768 && n <= 32767) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n, 0);
    return b;
  }
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}
