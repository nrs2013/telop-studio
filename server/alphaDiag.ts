// VP9 / VP8 + alpha self-test and diagnostic helpers.
//
// Goal: on every server start (and on demand via /api/diag/alpha-selftest),
// run the current environment's ffmpeg through ~7 different encode recipes
// against the *same* RGBA source, and report which recipes successfully
// preserve alpha end-to-end. Verification is done by decoding the output
// WebM's first frame back to PNG and asking ffprobe whether that PNG's
// pix_fmt is rgba (alpha survived) or rgb24 (alpha dropped).
//
// This gives us a truth table of "what actually works on this Railway
// image" without depending on any single theory — so when the end-user
// reports "still no transparency", we already know whether the problem is
// the encoder, the muxer, or upstream of libvpx, and which recipe to
// promote to production.

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

export type VariantResult = {
  name: string;
  description: string;
  codec: string;
  encodeExitCode: number | null;
  outputExists: boolean;
  outputBytes: number;
  outputPixFmt: string | null;
  outputAlphaMode: string | null;
  roundtripPixFmt: string | null;
  worked: boolean;
  error: string | null;
};

type Variant = {
  name: string;
  description: string;
  codec: "libvpx-vp9" | "libvpx";
  args: string[];
  // If set, only apply arguments to a pre-step (e.g., 2-pass first pass).
  twoPass?: boolean;
};

const VARIANTS: Variant[] = [
  {
    name: "vp9_current",
    description: "本番相当: libvpx-vp9 CRF + format filter + alpha_mode meta",
    codec: "libvpx-vp9",
    args: [
      "-vf", "format=yuva420p",
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-crf", "30",
      "-b:v", "0",
      "-deadline", "good",
      "-cpu-used", "4",
      "-metadata:s:v:0", "alpha_mode=1",
    ],
  },
  {
    name: "vp9_minimal",
    description: "VP9 を最小引数 (Jake Archibald / WebM wiki のサンプル相当)",
    codec: "libvpx-vp9",
    args: [
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-b:v", "1M",
    ],
  },
  {
    name: "vp9_crf_no_meta",
    description: "VP9 CRF のみ、フィルタ / alpha_mode メタなし",
    codec: "libvpx-vp9",
    args: [
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-crf", "30",
      "-b:v", "0",
    ],
  },
  {
    name: "vp9_2pass",
    description: "VP9 2-pass 可変ビットレート",
    codec: "libvpx-vp9",
    args: [
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-b:v", "1M",
    ],
    twoPass: true,
  },
  {
    name: "vp8_minimal",
    description: "VP8 最小 (Remotion 方式)",
    codec: "libvpx",
    args: [
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-b:v", "1M",
    ],
  },
  {
    name: "vp8_crf",
    description: "VP8 CRF",
    codec: "libvpx",
    args: [
      "-pix_fmt", "yuva420p",
      "-auto-alt-ref", "0",
      "-crf", "10",
      "-b:v", "0",
    ],
  },
  {
    name: "vp9_yuva420p_via_vf_only",
    description: "VP9 の pix_fmt を -vf だけで指定 (-pix_fmt なし)",
    codec: "libvpx-vp9",
    args: [
      "-vf", "format=yuva420p",
      "-auto-alt-ref", "0",
      "-b:v", "1M",
    ],
  },
];

function ffprobeBinFor(ffmpegBin: string): string {
  return ffmpegBin.replace(/ffmpeg(7)?$/, "ffprobe");
}

function generateTestFrames(ffmpegBin: string, workDir: string): { pattern: string; count: number; error: string | null } {
  const pattern = path.join(workDir, "src_%03d.png");
  // 10 枚の 128x128 RGBA PNG を生成。
  //  - R チャンネルは水平グラデーション
  //  - 上下で alpha を変える (上半 alpha=255, 下半 alpha=64) → 透過の有無が一目で分かる
  // geq フィルタは libavfilter の標準機能なので Debian ffmpeg でも入っている。
  const source = [
    "color=c=gray:size=128x128:rate=10:duration=1",
    "format=rgba",
    "geq=r='255*(X/128)':g='40':b='40':a='if(lt(Y,64),255,64)'",
  ].join(",");
  const res = spawnSync(
    ffmpegBin,
    [
      "-y", "-v", "error",
      "-f", "lavfi",
      "-i", source,
      "-frames:v", "10",
      pattern,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  if (res.status !== 0) {
    return { pattern, count: 0, error: res.stderr?.trim() || `exit ${res.status}` };
  }
  // Count how many frames actually got written.
  let count = 0;
  for (let i = 1; i <= 10; i++) {
    if (fs.existsSync(path.join(workDir, `src_${String(i).padStart(3, "0")}.png`))) count++;
  }
  return { pattern, count, error: null };
}

function probePixFmt(ffprobeBin: string, file: string): { pixFmt: string | null; alphaMode: string | null } {
  const res = spawnSync(
    ffprobeBin,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=pix_fmt:stream_tags=alpha_mode",
      "-of", "default=nw=1",
      file,
    ],
    { encoding: "utf8" },
  );
  const out = res.stdout || "";
  const pm = out.match(/pix_fmt=([\w\-]+)/)?.[1] || null;
  const am = out.match(/TAG:alpha_mode=(\w+)/)?.[1] || null;
  return { pixFmt: pm, alphaMode: am };
}

function roundtripDecode(ffmpegBin: string, ffprobeBin: string, webm: string, pngOut: string): string | null {
  const enc = spawnSync(
    ffmpegBin,
    ["-y", "-v", "error", "-i", webm, "-vframes", "1", pngOut],
    { encoding: "utf8", timeout: 10000 },
  );
  if (enc.status !== 0 || !fs.existsSync(pngOut)) return null;
  const pr = spawnSync(
    ffprobeBin,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=pix_fmt",
      "-of", "default=nw=1:nk=1",
      pngOut,
    ],
    { encoding: "utf8" },
  );
  return pr.stdout?.trim() || null;
}

function runVariant(
  ffmpegBin: string,
  ffprobeBin: string,
  srcPattern: string,
  workDir: string,
  v: Variant,
): VariantResult {
  const outPath = path.join(workDir, `out_${v.name}.webm`);
  const roundtripPng = path.join(workDir, `rt_${v.name}.png`);
  const result: VariantResult = {
    name: v.name,
    description: v.description,
    codec: v.codec,
    encodeExitCode: null,
    outputExists: false,
    outputBytes: 0,
    outputPixFmt: null,
    outputAlphaMode: null,
    roundtripPixFmt: null,
    worked: false,
    error: null,
  };

  try {
    const passLog = path.join(workDir, `pass_${v.name}`);
    if (v.twoPass) {
      // Pass 1 — write stats to /dev/null-ish
      const pass1 = spawnSync(
        ffmpegBin,
        [
          "-y", "-v", "error",
          "-framerate", "10",
          "-i", srcPattern,
          "-c:v", v.codec,
          ...v.args,
          "-pass", "1", "-passlogfile", passLog,
          "-an", "-f", "webm",
          "/dev/null",
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      if (pass1.status !== 0) {
        result.error = `pass1 exit ${pass1.status}: ${(pass1.stderr || "").split("\n").slice(-2).join(" ")}`;
        return result;
      }
      const pass2 = spawnSync(
        ffmpegBin,
        [
          "-y", "-v", "error",
          "-framerate", "10",
          "-i", srcPattern,
          "-c:v", v.codec,
          ...v.args,
          "-pass", "2", "-passlogfile", passLog,
          outPath,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      result.encodeExitCode = pass2.status ?? null;
      if (pass2.status !== 0) {
        result.error = `pass2 exit ${pass2.status}: ${(pass2.stderr || "").split("\n").slice(-2).join(" ")}`;
        return result;
      }
    } else {
      const enc = spawnSync(
        ffmpegBin,
        [
          "-y", "-v", "error",
          "-framerate", "10",
          "-i", srcPattern,
          "-c:v", v.codec,
          ...v.args,
          outPath,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      result.encodeExitCode = enc.status ?? null;
      if (enc.status !== 0) {
        result.error = `encode exit ${enc.status}: ${(enc.stderr || "").split("\n").slice(-2).join(" ")}`;
        return result;
      }
    }

    if (!fs.existsSync(outPath)) {
      result.error = "output file not created";
      return result;
    }
    result.outputExists = true;
    result.outputBytes = fs.statSync(outPath).size;

    const probe = probePixFmt(ffprobeBin, outPath);
    result.outputPixFmt = probe.pixFmt;
    result.outputAlphaMode = probe.alphaMode;

    const rt = roundtripDecode(ffmpegBin, ffprobeBin, outPath, roundtripPng);
    result.roundtripPixFmt = rt;

    // 定義: roundtrip した PNG が rgba / rgba64be / ya8 / yuva420p いずれかで
    // alpha を保持していれば「透過成功」とみなす。
    result.worked = !!rt && /^(rgba|rgba64|ya8|yuva[24]\d+p)/i.test(rt);
  } catch (e: any) {
    result.error = e?.message || String(e);
  }
  return result;
}

export type AlphaSelfTestReport = {
  ffmpegVersionLine: string;
  libvpxVersionLine: string | null;
  libvpxEncoders: string[];
  sourceError: string | null;
  sourcePixFmt: string | null;
  sourceAlphaAvg: string | null;
  results: VariantResult[];
  workingVariants: string[];
  elapsedMs: number;
};

export function runAlphaSelfTest(ffmpegBin = "ffmpeg"): AlphaSelfTestReport {
  const ffprobeBin = ffprobeBinFor(ffmpegBin);
  const startedAt = Date.now();

  const ver = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8" });
  const verText = (ver.stdout || "") + (ver.stderr || "");
  const ffmpegVersionLine = verText.split("\n")[0] || "(no ffmpeg)";
  const libvpxVersionLine = verText.split("\n").find((l) => /libvpx/i.test(l))?.trim() || null;

  const enc = spawnSync(ffmpegBin, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const libvpxEncoders = ((enc.stdout || "") + (enc.stderr || ""))
    .split("\n")
    .filter((l) => /libvpx/i.test(l))
    .map((l) => l.trim());

  // Ephemeral workdir under /tmp (container-safe, auto-cleaned by OS).
  const workDir = path.join(os.tmpdir(), `alpha_diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  let sourceError: string | null = null;
  let sourcePixFmt: string | null = null;
  let sourceAlphaAvg: string | null = null;
  let results: VariantResult[] = [];
  try {
    const gen = generateTestFrames(ffmpegBin, workDir);
    if (gen.error || gen.count === 0) {
      sourceError = gen.error || "no frames generated";
    } else {
      // Probe the source so the report can attest that the fixtures actually
      // carry alpha (otherwise "all variants failed" would be a false alarm).
      const srcFile = path.join(workDir, "src_001.png");
      const probe = probePixFmt(ffprobeBin, srcFile);
      sourcePixFmt = probe.pixFmt;
      try {
        // Note: signalstats.metadata=print emits its values via the "info"
        // log level, so we must NOT pass -v error here.
        const stats = spawnSync(
          ffmpegBin,
          ["-hide_banner", "-nostdin", "-i", srcFile, "-vf", "alphaextract,signalstats,metadata=print", "-f", "null", "-"],
          { encoding: "utf8", timeout: 8000 },
        );
        const out = (stats.stderr || "") + (stats.stdout || "");
        sourceAlphaAvg = out.match(/YAVG=([\d.]+)/)?.[1] || null;
      } catch {}

      for (const v of VARIANTS) {
        results.push(runVariant(ffmpegBin, ffprobeBin, gen.pattern, workDir, v));
      }
    }
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }

  const workingVariants = results.filter((r) => r.worked).map((r) => r.name);
  return {
    ffmpegVersionLine,
    libvpxVersionLine,
    libvpxEncoders,
    sourceError,
    sourcePixFmt,
    sourceAlphaAvg,
    results,
    workingVariants,
    elapsedMs: Date.now() - startedAt,
  };
}

export function formatReport(r: AlphaSelfTestReport): string {
  const lines: string[] = [];
  lines.push("┌────────────────────────────────────────────────────────────────────────────────────────┐");
  lines.push(`│  ALPHA SELF-TEST  (${r.elapsedMs}ms)`.padEnd(89) + "│");
  lines.push("├────────────────────────────────────────────────────────────────────────────────────────┤");
  lines.push(`│  ffmpeg : ${r.ffmpegVersionLine.slice(0, 76)}`.padEnd(89) + "│");
  if (r.libvpxVersionLine) {
    lines.push(`│  libvpx : ${r.libvpxVersionLine.slice(0, 76)}`.padEnd(89) + "│");
  }
  lines.push(`│  encoders : ${(r.libvpxEncoders.join(" | ") || "(none!)").slice(0, 73)}`.padEnd(89) + "│");
  lines.push("└────────────────────────────────────────────────────────────────────────────────────────┘");

  if (r.sourceError) {
    lines.push(`  ⚠  テスト用フレーム生成に失敗: ${r.sourceError}`);
    return lines.join("\n");
  }

  // Source attestation — if the source frames themselves don't carry alpha,
  // all the "opaque output" verdicts below would be false alarms.
  const srcAlphaValid = r.sourcePixFmt && /^(rgba|ya8|rgba64|yuva)/i.test(r.sourcePixFmt);
  lines.push(`  source : pix_fmt=${r.sourcePixFmt || "?"}  alpha_avg=${r.sourceAlphaAvg ?? "?"}  ${srcAlphaValid ? "✓ has alpha" : "✗ NO ALPHA IN SOURCE!"}`);

  lines.push("");
  lines.push("  Variant                    Codec         Output            Roundtrip       Result");
  lines.push("  -----------------------------------------------------------------------------------");
  for (const v of r.results) {
    const name = v.name.padEnd(25);
    const codec = v.codec.padEnd(13);
    const out = (v.outputPixFmt || "-").padEnd(18);
    const rt = (v.roundtripPixFmt || "-").padEnd(15);
    const verdict = v.worked ? "✓ ALPHA OK" : v.error ? "✗ ERROR" : "✗ opaque";
    lines.push(`  ${name}${codec} ${out}${rt} ${verdict}`);
    if (v.error) {
      lines.push(`    └ err: ${v.error.slice(0, 82)}`);
    }
  }

  lines.push("");
  if (r.workingVariants.length === 0) {
    lines.push("  ⚠  どの recipe も alpha を保持できませんでした。環境側の問題 → 二本立て muxer 路線へ。");
  } else {
    lines.push(`  ✓  透過が通った recipe: ${r.workingVariants.join(", ")}`);
  }
  return lines.join("\n");
}

export function logAlphaSelfTest(ffmpegBin = "ffmpeg"): void {
  try {
    const report = runAlphaSelfTest(ffmpegBin);
    const text = formatReport(report);
    // Dump in a single block so Railway's log UI keeps it together.
    console.log("\n" + text + "\n");
  } catch (e: any) {
    console.error(`[AlphaDiag] self-test crashed: ${e?.message || e}`);
  }
}
