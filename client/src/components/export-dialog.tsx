import { useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Copy, Check, ChevronDown, CircleCheck, FolderArchive, Film, Zap } from "lucide-react";
import type { LyricLine, Project } from "@shared/schema";
import { drawTextWithRuby } from "@/lib/rubyParser";
import { storage } from "@/lib/storage";

export interface ExportPresetConfig {
  creditFontWeight: string;
  creditBaseXRatio: number;
  creditRightMarginRatio: number;
  creditCharDelay: number;
  creditCharAnimDur: number;
  creditRightCharDelay: number;
  creditRightCharAnimDur: number;
}

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  presetConfig: ExportPresetConfig;
  lyrics: LyricLine[];
  audioUrl: string | null;
  audioFileName?: string | null;
}

type ExportMode = "server" | "prores" | "zip";




async function uploadWebmToDropbox(blob: Blob, fileName: string, preset: string): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append("movie", blob, fileName);
    formData.append("preset", preset);
    formData.append("fileName", fileName);
    const res = await fetch("/api/dropbox/upload-movie", { method: "POST", body: formData });
    return res.ok;
  } catch {
    return false;
  }
}

export function ExportDialog({
  open,
  onOpenChange,
  project,
  presetConfig,
  lyrics,
  audioUrl,
  audioFileName,
}: ExportDialogProps) {
  const projectId = project.id;
  const projectName = project.name;
  const outputWidth = project.outputWidth;
  const outputHeight = project.outputHeight;
  const fontSize = project.fontSize;
  const fontFamily = project.fontFamily;
  const fontColor = project.fontColor;
  const strokeColor = project.strokeColor;
  const strokeWidth = project.strokeWidth;
  const strokeBlur = project.strokeBlur;
  const textAlign = project.textAlign;
  const textX = project.textX;
  const textY = project.textY;
  const songTitle = project.songTitle || "";
  const motifColor = project.motifColor || "#4466FF";
  const lyricsCredit = project.lyricsCredit || "";
  const musicCredit = project.musicCredit || "";
  const arrangementCredit = project.arrangementCredit || "";
  const membersCredit = project.membersCredit || "";
  const audioTrimStart = project.audioTrimStart ?? 0;
  const activeAudioTrackId = project.activeAudioTrackId ?? null;
  const creditInTime = project.creditInTime ?? null;
  const creditOutTime = project.creditOutTime ?? null;
  const creditLineY = project.creditLineY ?? 80;
  const cTitleSize = project.creditTitleFontSize ?? 64;
  const cLyricsSize = project.creditLyricsFontSize ?? 36;
  const cMusicSize = project.creditMusicFontSize ?? 36;
  const cArrangeSize = project.creditArrangementFontSize ?? 36;
  const cMembersSize = project.creditMembersFontSize ?? 36;
  const cRightTitleSize = project.creditRightTitleFontSize ?? 38;
  const creditWipeStartMs = project.creditWipeStartMs ?? null;
  const effectiveRightTitle = project.creditRightTitle || songTitle || "";
  const rightTitleText = effectiveRightTitle.trim();
  const [fps, setFps] = useState("30");
  const [videoBitrate, setVideoBitrate] = useState("4M");
  const [audioBitrate, setAudioBitrate] = useState("64k");
  const [exportMode, setExportMode] = useState<ExportMode>("server");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [exportDone, setExportDone] = useState(false);
  const cancelRef = useRef(false);

  const timedLyrics = lyrics.filter((l) => l.startTime !== null && l.endTime !== null);

  const [copied, setCopied] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState<string | null>(null);
  const [copiedProRes, setCopiedProRes] = useState(false);

  const drawFrame = (ctx: CanvasRenderingContext2D, time: number, sortedLyrics: LyricLine[]) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outputWidth, outputHeight);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.setLineDash([]);

    let activeLine: LyricLine | undefined;
    for (let i = sortedLyrics.length - 1; i >= 0; i--) {
      const l = sortedLyrics[i];
      if (l.startTime !== null && l.endTime !== null && time >= l.startTime && time < l.endTime) {
        activeLine = l;
        break;
      }
    }

    let fadeOpacity = 1;
    if (activeLine) {
      const fi = activeLine.fadeIn ?? 0;
      const fo = activeLine.fadeOut ?? 0;
      if (fi > 0 && activeLine.startTime !== null) {
        const elapsed = time - activeLine.startTime;
        if (elapsed < fi) fadeOpacity = Math.max(0, elapsed / fi);
      }
      if (fo > 0 && activeLine.endTime !== null) {
        const remaining = activeLine.endTime - time;
        if (remaining < fo) fadeOpacity = Math.max(0, remaining / fo);
      }
    }

    const DEFAULT_CREDIT_ANIM_MS = 6700;
    const rawCreditAnimDurMs = project.creditAnimDuration ?? DEFAULT_CREDIT_ANIM_MS;
    // OUT 段階用スケール（既存）。TITLE B 帯（ワイプ + 右タイトル）の長さで決まる。
    const animScale = rawCreditAnimDurMs / DEFAULT_CREDIT_ANIM_MS;
    const outAnimDur = 1.5 * animScale;
    // IN 段階用スケール。TITLE A 帯の幅（creditHoldStartMs）に合わせて逆算。
    const songTitleForInScale = (project.songTitle || "").trim();
    const baseInDurMs = (() => {
      const titleAnim = songTitleForInScale.length > 0
        ? (songTitleForInScale.length - 1) * presetConfig.creditCharDelay + presetConfig.creditCharAnimDur
        : 0;
      return Math.max(100, titleAnim + 100 + 1200);
    })();
    const bpmForFallback = project.detectedBpm || 120;
    const barMsForFallback = (60 / bpmForFallback) * 4000;
    const defaultHoldStartMsForExport = Math.round(barMsForFallback * 2);
    const effectiveHoldStartMsForExport = project.creditHoldStartMs ?? defaultHoldStartMsForExport;
    const inAnimScale = effectiveHoldStartMsForExport / baseInDurMs;
    const currentLayout = project.creditTitleLayout ?? 1;
    const customWipeStartMs = project.creditWipeStartMs;
    const wipeStartForTiming = customWipeStartMs ?? Math.round(rawCreditAnimDurMs * 3 / 4);
    const wipeDurForTiming = Math.round(rawCreditAnimDurMs * 0.5);
    const rtTextForTiming = rightTitleText;
    const rtCharDelayForTiming = presetConfig.creditRightCharDelay * animScale;
    const rtCharAnimDurForTiming = presetConfig.creditRightCharAnimDur * animScale;
    const rtTotalDurForTiming = rtTextForTiming.length > 0
      ? ((rtTextForTiming.length - 1) * rtCharDelayForTiming + rtCharAnimDurForTiming + 500)
      : 0;
    const fullCreditDurMs = wipeStartForTiming + wipeDurForTiming + rtTotalDurForTiming;
    const fullCreditDurSec = fullCreditDurMs / 1000;
    const isCreditActiveByTiming = creditInTime !== null && time >= creditInTime && (creditOutTime !== null ? time < creditOutTime + outAnimDur : time < creditInTime + fullCreditDurSec);

    const hasCreditContent = songTitle || lyricsCredit || musicCredit || arrangementCredit || membersCredit || rightTitleText;
    if (isCreditActiveByTiming && hasCreditContent && creditInTime !== null) {
      const elapsedMs = (time - creditInTime) * 1000;

      const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
      const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

      const lineY = outputHeight * (creditLineY / 100);
      const creditBaseX = outputWidth * presetConfig.creditBaseXRatio;
      const creditWeight = presetConfig.creditFontWeight;

      // トレース風アニメ：stroke を「左→右へ」 走る範囲だけ描画、fill は時間差で全体に乗せる。
      // strokeProgress=1, fillProgress=1 で呼ばれる場合は普通の全描画になる（クレジット類などの非タイトルで使う）。
      const drawStrokeTextInline = (
        text: string, x: number, y: number, font: string,
        align: CanvasTextAlign, baseline: CanvasTextBaseline,
        strokeProgress: number, fillProgress: number,
        alpha: number = 1, color: string = fontColor,
        sw: number = 1.5,
      ) => {
        const fontSizeMatch = font.match(/(\d+)px/);
        const thisFontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 72;
        const scaledStrokeW = strokeWidth * (thisFontSize / 72);
        const scaledBlur = (strokeBlur ?? 0);
        ctx.save();
        ctx.font = font;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        ctx.setLineDash([]);

        // 共通の clip 領域計算
        const measuredW = ctx.measureText(text).width;
        const leftX = align === "center" ? x - measuredW / 2
                    : align === "right" ? x - measuredW
                    : x;
        const padY = thisFontSize * 0.4;
        const heightY = thisFontSize * 1.6;
        const topY = baseline === "top" ? y - padY
                   : baseline === "middle" ? y - thisFontSize * 0.7
                   : y - thisFontSize - padY * 0.3;

        // stroke：左から strokeProgress 分だけ走らせる
        if (strokeProgress > 0 && scaledStrokeW > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(leftX, topY, measuredW * strokeProgress, heightY);
          ctx.clip();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = scaledStrokeW;
          ctx.lineJoin = "round";
          if (scaledBlur > 0) { ctx.shadowColor = strokeColor; ctx.shadowBlur = scaledBlur; }
          ctx.strokeText(text, x, y);
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
          ctx.restore();
        }

        // fill：左から fillProgress 分だけ「塗りが走る」（stroke を追いかける）
        if (fillProgress > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(leftX, topY, measuredW * fillProgress, heightY);
          ctx.clip();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillText(text, x, y);
          ctx.restore();
        }

        ctx.restore();
      };

      const wipeStart = customWipeStartMs ?? Math.round(rawCreditAnimDurMs * 3 / 4);
      const wipeDur = Math.round(rawCreditAnimDurMs * 0.5);
      const wipeP = clamp01((elapsedMs - wipeStart) / wipeDur);
      const grp1Visible = wipeP < 1;
      const rtCharDelay = presetConfig.creditRightCharDelay * animScale;
      const rtCharAnimDur = presetConfig.creditRightCharAnimDur * animScale;
      const grp2Start = wipeStart + wipeDur;
      const outAnimDurMs = outAnimDur * 1000;
      let outWipeP = 0;
      if (creditOutTime !== null && time >= creditOutTime) {
        outWipeP = easeInOut(clamp01((time - creditOutTime) * 1000 / outAnimDurMs));
      }

      const barActive = elapsedMs < fullCreditDurMs;
      const isOutAnimating = creditOutTime !== null && time >= creditOutTime && time < creditOutTime + outAnimDur;
      const isHolding = !barActive && creditOutTime !== null && time < creditOutTime;
      if (barActive || isHolding || isOutAnimating) {
        const lineDrawn = easeOut(clamp01(elapsedMs / (2000 * inAnimScale)));
        const lineRight = outputWidth * lineDrawn;
        const lineLeft = outputWidth * outWipeP;
        if (lineRight > lineLeft) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(lineLeft, lineY);
          ctx.lineTo(lineRight, lineY);
          ctx.stroke();
        }

        if (grp1Visible) {
          ctx.save();
          const clipLeftIn = wipeP > 0 ? outputWidth * wipeP : 0;
          const clipLeftOut = outWipeP > 0 ? outputWidth * outWipeP : 0;
          const effectiveClipLeft = Math.max(clipLeftIn, clipLeftOut);
          if (effectiveClipLeft > 0) {
            ctx.beginPath();
            ctx.rect(effectiveClipLeft, 0, outputWidth - effectiveClipLeft, outputHeight);
            ctx.clip();
          }

          if (currentLayout === 2) {
            const titleFont = `bold ${cTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
            ctx.font = titleFont;
            const titleText = songTitle || "";
            const titleWidth = ctx.measureText(titleText).width;
            const gap = cTitleSize * 0.6;
            const rightX = creditBaseX + titleWidth + gap;

            // IN 段階：TITLE A 帯の幅（holdStart）に合わせてスケール
            const charDelay = presetConfig.creditCharDelay * inAnimScale;
            const charAnimDur = presetConfig.creditCharAnimDur * inAnimScale;
            const titleStart = 0;

            let charX = creditBaseX;
            for (let ci = 0; ci < titleText.length; ci++) {
              const ch = titleText[ci];
              const chStart = titleStart + ci * charDelay;
              // トレース：前半 60% で stroke が左→右へ走る、後半 40% で fill が乗る
              const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / (charAnimDur * 0.6)));
              const chFillP = easeOut(clamp01((elapsedMs - chStart - charAnimDur * 0.6) / (charAnimDur * 0.4)));
              if (chStrokeP > 0) {
                drawStrokeTextInline(ch, charX, lineY - 12, titleFont, "left", "bottom", chStrokeP, chFillP);
              }
              ctx.font = titleFont;
              charX += ctx.measureText(ch).width;
            }

            const titleEndTime = titleStart + (titleText.length - 1) * charDelay + charAnimDur;
            const creditsStart = titleEndTime + 100 * inAnimScale;
            const creditsFillDur = 1200 * inAnimScale;
            const creditsFadeP = easeOut(clamp01((elapsedMs - creditsStart) / creditsFillDur));

            if (creditsFadeP > 0) {
              const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              const memberText = membersCredit ? membersCredit.split(",").join("  ") : "";
              let staffX = rightX;
              if (memberText) {
                ctx.save();
                ctx.globalAlpha = creditsFadeP;
                drawStrokeTextInline(memberText, rightX, lineY - 12, memFont, "left", "bottom", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                ctx.font = memFont;
                staffX = rightX + ctx.measureText(memberText).width + ctx.measureText("　").width;
                ctx.restore();
              }

              const staffParts: { text: string; size: number }[] = [];
              if (lyricsCredit) staffParts.push({ text: `作詞：${lyricsCredit}`, size: cLyricsSize });
              const sameComposerAnim = musicCredit && arrangementCredit && musicCredit.trim() === arrangementCredit.trim();
              if (sameComposerAnim) {
                staffParts.push({ text: `作曲/編曲：${musicCredit}`, size: cMusicSize });
              } else {
                if (musicCredit) staffParts.push({ text: `作曲：${musicCredit}`, size: cMusicSize });
                if (arrangementCredit) staffParts.push({ text: `編曲：${arrangementCredit}`, size: cArrangeSize });
              }

              if (staffParts.length > 0) {
                ctx.save();
                ctx.globalAlpha = creditsFadeP;
                let partX = staffX;
                for (let pi = 0; pi < staffParts.length; pi++) {
                  const p = staffParts[pi];
                  const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
                  drawStrokeTextInline(p.text, partX, lineY - 12, pFont, "left", "bottom", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                  ctx.font = pFont;
                  partX += ctx.measureText(p.text).width;
                  if (pi < staffParts.length - 1) partX += ctx.measureText("　").width;
                }
                ctx.restore();
              }
            }
          } else {
          // IN 段階：TITLE A 帯の幅（holdStart）に合わせてスケール
          const charDelay = presetConfig.creditCharDelay * inAnimScale;
          const charAnimDur = presetConfig.creditCharAnimDur * inAnimScale;
          const titleStart = 0;

          const bigFont = `bold ${cTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          ctx.font = bigFont;
          let charX = creditBaseX;
          const titleText = songTitle || "";
          for (let ci = 0; ci < titleText.length; ci++) {
            const ch = titleText[ci];
            const chStart = titleStart + ci * charDelay;
            // トレース：前半 60% で stroke が左→右へ走る、後半 40% で fill が乗る
            const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / (charAnimDur * 0.6)));
            const chFillP = easeOut(clamp01((elapsedMs - chStart - charAnimDur * 0.6) / (charAnimDur * 0.4)));
            if (chStrokeP > 0) {
              drawStrokeTextInline(ch, charX, lineY - 12, bigFont, "left", "bottom", chStrokeP, chFillP);
            }
            ctx.font = bigFont;
            charX += ctx.measureText(ch).width;
          }

          const titleEndTime = titleStart + (titleText.length - 1) * charDelay + charAnimDur;
          const creditsStart = titleEndTime + 100 * inAnimScale;
          const creditsFillDur = 1200 * inAnimScale;
          const creditsFadeP = easeOut(clamp01((elapsedMs - creditsStart) / creditsFillDur));

          if (creditsFadeP > 0) {
            const animCreditParts: { text: string; size: number }[] = [];
            if (lyricsCredit) animCreditParts.push({ text: `作詞：${lyricsCredit}`, size: cLyricsSize });
            const sameComposerAnim = musicCredit && arrangementCredit && musicCredit.trim() === arrangementCredit.trim();
            if (sameComposerAnim) {
              animCreditParts.push({ text: `作曲/編曲：${musicCredit}`, size: cMusicSize });
            } else {
              if (musicCredit) animCreditParts.push({ text: `作曲：${musicCredit}`, size: cMusicSize });
              if (arrangementCredit) animCreditParts.push({ text: `編曲：${arrangementCredit}`, size: cArrangeSize });
            }

            let infoY = lineY + 15;
            if (membersCredit) {
              const memberText = membersCredit.split(",").join("  ");
              const memFont = `${creditWeight} ${cMembersSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
              ctx.save();
              ctx.globalAlpha = creditsFadeP;
              drawStrokeTextInline(memberText, creditBaseX, infoY, memFont, "left", "top", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
              ctx.restore();
              infoY += cMembersSize + 16;
            }
            if (animCreditParts.length > 0) {
              ctx.save();
              ctx.globalAlpha = creditsFadeP;
              let partX = creditBaseX;
              for (let pi = 0; pi < animCreditParts.length; pi++) {
                const p = animCreditParts[pi];
                const pFont = `${creditWeight} ${p.size}px "${fontFamily}", "Noto Sans JP", sans-serif`;
                drawStrokeTextInline(p.text, partX, infoY, pFont, "left", "top", 1, 1, creditsFadeP, "rgba(255,255,255,0.9)");
                ctx.font = pFont;
                partX += ctx.measureText(p.text).width;
                if (pi < animCreditParts.length - 1) partX += ctx.measureText("　").width;
              }
              ctx.restore();
            }
          }
        }

          ctx.restore();
        }

        if (elapsedMs >= grp2Start && outWipeP < 1) {
          ctx.save();
          if (outWipeP > 0) {
            const clipL = outputWidth * outWipeP;
            ctx.beginPath();
            ctx.rect(clipL, 0, outputWidth - clipL, outputHeight);
            ctx.clip();
          }
          const stFont = `bold ${cRightTitleSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
          const stX = outputWidth - outputWidth * presetConfig.creditRightMarginRatio;
          const stY = lineY - outputHeight * 0.01;

          const baseRtCharDelay = presetConfig.creditRightCharDelay * animScale;
          const baseRtCharAnimDur = presetConfig.creditRightCharAnimDur * animScale;
          ctx.font = stFont;
          if (rightTitleText.length > 0) {
            const charWidths: number[] = [];
            for (let ci = 0; ci < rightTitleText.length; ci++) {
              charWidths.push(ctx.measureText(rightTitleText[ci]).width);
            }
            const rightEdges: number[] = [];
            let re = stX;
            for (let ci = rightTitleText.length - 1; ci >= 0; ci--) {
              rightEdges[ci] = re;
              re -= charWidths[ci];
            }
            for (let ci = 0; ci < rightTitleText.length; ci++) {
              const ch = rightTitleText[ci];
              const chStart = grp2Start + ci * baseRtCharDelay;
              const chStrokeP = easeInOut(clamp01((elapsedMs - chStart) / baseRtCharAnimDur));
              const chFillP = easeOut(clamp01((elapsedMs - chStart - baseRtCharAnimDur * 0.7) / (baseRtCharAnimDur * 0.5)));
              if (chStrokeP > 0) {
                drawStrokeTextInline(ch, rightEdges[ci], stY, stFont, "right", "bottom", chStrokeP, chFillP);
              }
            }
          }
          ctx.restore();
        }
      }
    }

    const tx = textX ?? (textAlign === "left" ? 40 : textAlign === "right" ? outputWidth - 40 : outputWidth / 2);
    const ty = textY ?? outputHeight / 2;
    if (activeLine) {
      const lineFontSize = activeLine.fontSize ?? fontSize;
      drawTextWithRuby(ctx, activeLine.text, tx, ty, lineFontSize, fontFamily, textAlign, fontColor, strokeColor, strokeWidth, fadeOpacity, strokeBlur);
    }
  };

  const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      }, "image/png");
    });
  };

  const buildSegments = (sortedLyrics: LyricLine[], totalDuration: number, fpsNum: number): { time: number; duration: number }[] => {
    const effectiveStart = audioTrimStart > 0 ? audioTrimStart : 0;
    const timesSet = new Set<number>();
    timesSet.add(effectiveStart);

    for (const l of sortedLyrics) {
      if (l.startTime! >= effectiveStart) timesSet.add(l.startTime!);
      if (l.endTime! >= effectiveStart) timesSet.add(l.endTime!);
    }

    const DEFAULT_CREDIT_ANIM_MS = 6700;
    const creditAnimDurMs = project.creditAnimDuration ?? DEFAULT_CREDIT_ANIM_MS;
    const animScale = creditAnimDurMs / DEFAULT_CREDIT_ANIM_MS;
    const outAnimDur = 1.5 * animScale;
    const segCurrentLayout = project.creditTitleLayout ?? 1;
    const segWipeStartMs = project.creditWipeStartMs ?? Math.round(creditAnimDurMs * 3 / 4);
    const segWipeDurMs = Math.round(creditAnimDurMs * 0.5);
    const rtTextForTiming = (project.creditRightTitle || songTitle || "").trim();
    const rtCharDelayForTiming = presetConfig.creditRightCharDelay * animScale;
    const rtCharAnimDurForTiming = presetConfig.creditRightCharAnimDur * animScale;
    const rtTotalDurForTiming = rtTextForTiming.length > 0
      ? ((rtTextForTiming.length - 1) * rtCharDelayForTiming + rtCharAnimDurForTiming + 500)
      : 0;
    const segFullCreditDurMs = segWipeStartMs + segWipeDurMs + rtTotalDurForTiming;

    if (creditInTime !== null) {
      const frameDur = 1 / fpsNum;
      const inAnimEndSec = creditInTime + segFullCreditDurMs / 1000;
      for (let t = creditInTime; t < inAnimEndSec; t += frameDur) {
        if (t >= effectiveStart) timesSet.add(Math.round(t * fpsNum) / fpsNum);
      }
      if (inAnimEndSec >= effectiveStart) timesSet.add(Math.round(inAnimEndSec * fpsNum) / fpsNum);

      if (creditOutTime !== null) {
        const outEnd = creditOutTime + outAnimDur;
        if (creditOutTime > inAnimEndSec && creditOutTime >= effectiveStart) {
          timesSet.add(Math.round(creditOutTime * fpsNum) / fpsNum);
        }
        for (let t = creditOutTime; t < outEnd; t += frameDur) {
          if (t >= effectiveStart) timesSet.add(Math.round(t * fpsNum) / fpsNum);
        }
        if (outEnd >= effectiveStart) timesSet.add(Math.round(outEnd * fpsNum) / fpsNum);
      }
    }

    for (const l of sortedLyrics) {
      const fi = l.fadeIn ?? 0;
      const fo = l.fadeOut ?? 0;
      if (fi > 0 && l.startTime !== null) {
        const frameDur = 1 / fpsNum;
        for (let t = l.startTime; t < l.startTime + fi; t += frameDur) {
          if (t >= effectiveStart) timesSet.add(Math.round(t * fpsNum) / fpsNum);
        }
      }
      if (fo > 0 && l.endTime !== null) {
        const frameDur = 1 / fpsNum;
        for (let t = l.endTime - fo; t < l.endTime; t += frameDur) {
          if (t >= effectiveStart) timesSet.add(Math.round(t * fpsNum) / fpsNum);
        }
      }
    }

    timesSet.add(totalDuration);

    const times = [...timesSet].sort((a, b) => a - b);
    const minDuration = 1 / fpsNum;
    const segments: { time: number; duration: number }[] = [];

    for (let i = 0; i < times.length - 1; i++) {
      if (times[i] < effectiveStart) continue;
      let dur = times[i + 1] - times[i];
      if (dur < minDuration) dur = minDuration;
      dur = Math.round(dur * fpsNum) / fpsNum;
      if (dur <= 0) continue;
      segments.push({ time: times[i], duration: dur });
    }

    return segments;
  };

  const getTotalDuration = async (): Promise<number> => {
    const sortedLyrics = [...timedLyrics].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const lastEnd = Math.max(...sortedLyrics.map((l) => l.endTime || 0));
    let totalDuration = lastEnd;

    if (audioUrl) {
      const audio = new Audio();
      audio.src = audioUrl;
      await new Promise<void>((resolve) => {
        audio.addEventListener("loadedmetadata", () => {
          totalDuration = Math.max(totalDuration, audio.duration);
          resolve();
        });
        audio.addEventListener("error", () => resolve());
      });
    }

    return totalDuration;
  };

  const generateFrames = async (fpsNum: number): Promise<{ blobs: Blob[]; segments: { frame: number; duration: number }[] }> => {
    const sortedLyrics = [...timedLyrics].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    const totalDuration = await getTotalDuration();
    const segs = buildSegments(sortedLyrics, totalDuration, fpsNum);
    const totalUniqueFrames = segs.length;

    setStatus(`フレーム生成中... (${totalUniqueFrames}枚)`);

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    const epsilon = 0.001;
    const blobs: Blob[] = [];
    const segments: { frame: number; duration: number }[] = [];

    for (let i = 0; i < segs.length; i++) {
      if (cancelRef.current) break;
      const seg = segs[i];
      drawFrame(ctx, seg.time + epsilon, sortedLyrics);
      const blob = await canvasToPngBlob(canvas);
      blobs.push(blob);
      segments.push({ frame: i, duration: seg.duration });
      const pct = ((i + 1) / totalUniqueFrames) * 40;
      setProgress(pct);
      setStatus(`フレーム生成中... ${i + 1}/${totalUniqueFrames}`);
      if (i % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return { blobs, segments };
  };






  const handleServerExport = useCallback(async () => {
    if (timedLyrics.length === 0) return;
    cancelRef.current = false;
    setExporting(true);
    setExportDone(false);
    setProgress(0);
    setErrorMsg("");

    try {
      const fpsNum = parseInt(fps);
      const sortedLyrics = [...timedLyrics].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      const totalDuration = await getTotalDuration();
      const segs = buildSegments(sortedLyrics, totalDuration, fpsNum);
      const totalUniqueFrames = segs.length;

      setStatus("コンテンツ領域スキャン中...");
      setProgress(1);

      const scanCanvas = document.createElement("canvas");
      scanCanvas.width = outputWidth;
      scanCanvas.height = outputHeight;
      const scanCtx = scanCanvas.getContext("2d", { alpha: true })!;
      let globalMinY = outputHeight;
      let globalMaxY = 0;
      const SCAN_STEP = Math.max(1, Math.floor(segs.length / 40));
      for (let i = 0; i < segs.length; i += SCAN_STEP) {
        const seg = segs[i];
        drawFrame(scanCtx, seg.time + 0.001, sortedLyrics);
        const imgData = scanCtx.getImageData(0, 0, outputWidth, outputHeight);
        const d = imgData.data;
        for (let row = 0; row < outputHeight; row++) {
          const rowStart = row * outputWidth * 4;
          for (let col = 0; col < outputWidth; col++) {
            if (d[rowStart + col * 4 + 3] > 0) {
              if (row < globalMinY) globalMinY = row;
              if (row > globalMaxY) globalMaxY = row;
              break;
            }
          }
        }
      }

      if (globalMinY >= globalMaxY) {
        globalMinY = 0;
        globalMaxY = outputHeight - 1;
      }
      const CROP_PAD = 30;
      const cropTop = Math.max(0, globalMinY - CROP_PAD);
      const cropBottom = Math.min(outputHeight - 1, globalMaxY + CROP_PAD);
      const rawCropHeight = cropBottom - cropTop + 1;
      const cropActive = cropBottom > cropTop && rawCropHeight < outputHeight * 0.85;
      const cropY = cropActive ? cropTop : 0;
      const encWidth = outputWidth;
      // VP9 (yuva420p) / ProRes どちらも width/height が偶数必須。奇数だとエンコード失敗。
      // 下端を1px削って偶数に揃える(表示範囲内なので安全)。
      const rawEncHeight = cropActive ? rawCropHeight : outputHeight;
      const encHeight = rawEncHeight % 2 === 0 ? rawEncHeight : rawEncHeight - 1;

      if (cropActive) {
        console.log(`[WebM Export] Auto-crop: Y=${cropY} H=${encHeight} (原寸: ${outputWidth}x${outputHeight})`);
      }

      setStatus(cropActive ? `クロップ: ${encWidth}x${encHeight} (Y=${cropY}) フレーム生成中` : `フル解像度: ${encWidth}x${outputHeight} フレーム生成中`);
      setProgress(3);

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d", { alpha: true })!;
      const epsilon = 0.001;

      const cropCanvas = cropActive ? document.createElement("canvas") : null;
      if (cropCanvas) {
        cropCanvas.width = encWidth;
        cropCanvas.height = encHeight;
      }
      const cropCtx = cropCanvas ? cropCanvas.getContext("2d", { alpha: true })! : null;

      const getCroppedSource = (): HTMLCanvasElement => {
        if (cropActive && cropCanvas && cropCtx) {
          cropCtx.clearRect(0, 0, encWidth, encHeight);
          cropCtx.drawImage(canvas, 0, cropY, encWidth, encHeight, 0, 0, encWidth, encHeight);
          return cropCanvas;
        }
        return canvas;
      };

      const canvasToBlob = (cvs: HTMLCanvasElement): Promise<Blob> =>
        new Promise((resolve, reject) => {
          cvs.toBlob((b) => { if (b) resolve(b); else reject(new Error("toBlob failed")); }, "image/png");
        });

      setStatus(`PNG無損失フレーム生成中... (${totalUniqueFrames}枚, ${encWidth}x${encHeight})`);
      setProgress(4);

      const sessionRes = await fetch("/api/export/session", { method: "POST" });
      if (!sessionRes.ok) throw new Error("セッション作成に失敗しました");
      const { sessionId } = (await sessionRes.json());

      const blobs: Blob[] = [];
      const segments: { frame: number; duration: number }[] = [];

      for (let i = 0; i < segs.length; i++) {
        if (cancelRef.current) break;
        const seg = segs[i];
        drawFrame(ctx, seg.time + epsilon, sortedLyrics);
        const source = getCroppedSource();
        const blob = await canvasToBlob(source);
        blobs.push(blob);
        segments.push({ frame: i, duration: seg.duration });
        const pct = 4 + ((i + 1) / totalUniqueFrames) * 36;
        setProgress(pct);
        setStatus(`フレーム生成中... ${i + 1}/${totalUniqueFrames} (${encWidth}x${encHeight})`);
        if (i % 10 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (cancelRef.current) {
        setExporting(false);
        setProgress(0);
        setStatus("");
        return;
      }

      setStatus("フレームをアップロード中...");
      setProgress(42);

      // batchSize = how many frames per HTTP POST (multer accepts up to 500)
      // parallelUploads = how many POSTs flying at the same time to Railway
      // 30 × 5 = 150 frames in flight gives good throughput without stressing
      // the server's frame-upload handler (bumped from 20 × 3 = 60 when the
      // encoder was sped up server-side).
      const batchSize = 30;
      const parallelUploads = 5;
      let uploaded = 0;
      for (let i = 0; i < blobs.length; i += batchSize * parallelUploads) {
        if (cancelRef.current) break;
        const promises: Promise<void>[] = [];
        for (let p = 0; p < parallelUploads; p++) {
          const start = i + p * batchSize;
          if (start >= blobs.length) break;
          const batch = blobs.slice(start, Math.min(start + batchSize, blobs.length));
          const formData = new FormData();
          batch.forEach((blob, idx) => {
            formData.append("frames", blob, `frame_${String(start + idx).padStart(6, "0")}.png`);
          });
          promises.push(
            fetch(`/api/export/${sessionId}/frames`, { method: "POST", body: formData })
              .then(async (uploadRes) => {
                if (!uploadRes.ok) {
                  const errText = await uploadRes.text().catch(() => "");
                  throw new Error(`フレームアップロード失敗 (${uploadRes.status}): ${errText}`);
                }
                uploaded += batch.length;
              })
          );
        }
        await Promise.all(promises);
        const pct = 45 + (Math.min(uploaded, blobs.length) / blobs.length) * 20;
        setProgress(pct);
        setStatus(`フレームをアップロード中... ${Math.min(uploaded, blobs.length)}/${blobs.length}`);
      }

      if (cancelRef.current) {
        setExporting(false);
        setProgress(0);
        setStatus("");
        return;
      }

      let hasAudio = false;
      if (audioUrl) {
        setStatus("音声ファイルをアップロード中...");
        setProgress(67);
        let audioBlob: Blob | null = null;
        let audioFName = "audio.mp3";
        if (activeAudioTrackId) {
          const track = await storage.getAudioTrack(activeAudioTrackId);
          if (track) {
            audioBlob = new Blob([track.arrayBuffer], { type: track.mimeType || "audio/mpeg" });
            audioFName = track.fileName;
          }
        }
        if (!audioBlob) {
          const audioData = await storage.getAudio(projectId);
          if (audioData) {
            audioBlob = new Blob([audioData.arrayBuffer], { type: audioData.mimeType || "audio/mpeg" });
            audioFName = audioData.fileName;
          }
        }
        if (audioBlob) {
          const audioFormData = new FormData();
          audioFormData.append("audio", audioBlob, audioFName);
          const audioRes = await fetch(`/api/export/${sessionId}/audio`, {
            method: "POST",
            body: audioFormData,
          });
          if (!audioRes.ok) throw new Error("音声アップロードに失敗しました");
          hasAudio = true;
        }
      }

      setStatus(cropActive ? `サーバーでエンコード中... (VP9 Alpha WebM, ${encWidth}x${encHeight})` : "サーバーでエンコード中... (VP9 Alpha WebM)");
      setProgress(70);

      const encodeRes = await fetch(`/api/export/${sessionId}/encode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fps: fpsNum,
          videoBitrate,
          audioBitrate,
          segments,
          async: true,
          cropY: cropActive ? cropY : -1,
          fullHeight: cropActive ? outputHeight : 0,
        }),
      });

      if (!encodeRes.ok) {
        const errData = await encodeRes.json().catch(() => ({ message: "エンコード失敗" }));
        throw new Error(errData.message || "エンコードに失敗しました");
      }

      let encodeComplete = false;
      let pollFailCount = 0;
      while (!encodeComplete && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        const statusRes = await fetch(`/api/export/${sessionId}/status`, { cache: "no-store" });
        if (statusRes.status === 304) { continue; }
        if (!statusRes.ok) {
          pollFailCount++;
          if (pollFailCount >= 5) break;
          continue;
        }
        pollFailCount = 0;
        const st = await statusRes.json();
        if (st.status === "done") {
          encodeComplete = true;
          setProgress(90);
          setStatus("ダウンロード中...");
        } else if (st.status === "error") {
          throw new Error(st.error || "エンコード失敗");
        } else {
          setStatus("サーバーでエンコード中...");
        }
      }

      if (cancelRef.current || !encodeComplete) {
        setExporting(false);
        setProgress(0);
        setStatus("");
        return;
      }

      const dlRes = await fetch(`/api/export/${sessionId}/download`);
      if (!dlRes.ok) throw new Error("ダウンロードに失敗しました");
      const outputBlob = await dlRes.blob();
      const safeName = (projectName || "telop").replace(/[^\w\u3000-\u9fff\uff00-\uffef]/g, "_");
      const yTag = cropActive ? `_Y${cropY}_H${encHeight}` : "";
      const webmFileName = `【TELOP】${safeName}_vp9_alpha${yTag}.webm`;
      const url = URL.createObjectURL(outputBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = webmFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("Dropboxにアップロード中...");
      await uploadWebmToDropbox(outputBlob, webmFileName, project.preset || "other");

      const cropInfo = cropActive ? ` [クロップ: ${encWidth}x${encHeight}, Y=${cropY}]` : "";
      setProgress(100);
      setStatus(`完了${cropInfo}`);
      setExporting(false);
      setExportDone(true);
      return;
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorMsg(`書き出しエラー: ${err.message || err}`);
    }

    setExporting(false);
    setProgress(0);
    setStatus("");
  }, [timedLyrics, fps, videoBitrate, audioBitrate, audioUrl, project, presetConfig, activeAudioTrackId]);

  const handleProResExport = useCallback(async () => {
    if (timedLyrics.length === 0) return;
    cancelRef.current = false;
    setExporting(true);
    setExportDone(false);
    setProgress(0);
    setErrorMsg("");

    try {
      const fpsNum = parseInt(fps);
      const sortedLyrics = [...timedLyrics].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      const totalDuration = await getTotalDuration();
      const segs = buildSegments(sortedLyrics, totalDuration, fpsNum);
      const totalUniqueFrames = segs.length;

      setStatus("描画エリア解析中...");
      setProgress(1);

      const scanCanvas = document.createElement("canvas");
      scanCanvas.width = outputWidth;
      scanCanvas.height = outputHeight;
      const scanCtx = scanCanvas.getContext("2d", { alpha: true })!;
      let globalMinY = outputHeight;
      let globalMaxY = 0;
      const SCAN_STEP = Math.max(1, Math.floor(segs.length / 40));
      for (let i = 0; i < segs.length; i += SCAN_STEP) {
        const seg = segs[i];
        drawFrame(scanCtx, seg.time + 0.001, sortedLyrics);
        const imgData = scanCtx.getImageData(0, 0, outputWidth, outputHeight);
        const d = imgData.data;
        for (let row = 0; row < outputHeight; row++) {
          const rowStart = row * outputWidth * 4;
          for (let col = 0; col < outputWidth; col++) {
            if (d[rowStart + col * 4 + 3] > 0) {
              if (row < globalMinY) globalMinY = row;
              if (row > globalMaxY) globalMaxY = row;
              break;
            }
          }
        }
      }

      if (globalMinY >= globalMaxY) {
        globalMinY = 0;
        globalMaxY = outputHeight - 1;
      }
      const CROP_PAD = 30;
      const cropTop = Math.max(0, globalMinY - CROP_PAD);
      const cropBottom = Math.min(outputHeight - 1, globalMaxY + CROP_PAD);
      const rawCropHeight = cropBottom - cropTop + 1;
      const cropActive = cropBottom > cropTop && rawCropHeight < outputHeight * 0.85;
      const cropY = cropActive ? cropTop : 0;
      const encWidth = outputWidth;
      // VP9 (yuva420p) / ProRes どちらも width/height が偶数必須。奇数だとエンコード失敗。
      // 下端を1px削って偶数に揃える(表示範囲内なので安全)。
      const rawEncHeight = cropActive ? rawCropHeight : outputHeight;
      const encHeight = rawEncHeight % 2 === 0 ? rawEncHeight : rawEncHeight - 1;

      if (cropActive) {
        console.log(`[ProRes Export] Auto-crop: Y=${cropY} H=${encHeight} (原寸: ${outputWidth}x${outputHeight})`);
      }

      setStatus(cropActive ? `クロップ: ${encWidth}x${encHeight} (Y=${cropY}) 透過フレーム生成` : `フル解像度: ${encWidth}x${outputHeight} 透過フレーム生成`);
      setProgress(3);

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d", { alpha: true })!;
      const epsilon = 0.001;

      const cropCanvas = cropActive ? document.createElement("canvas") : null;
      if (cropCanvas) {
        cropCanvas.width = encWidth;
        cropCanvas.height = encHeight;
      }
      const cropCtx = cropCanvas ? cropCanvas.getContext("2d", { alpha: true })! : null;

      const getCroppedSource = (): HTMLCanvasElement => {
        if (cropActive && cropCanvas && cropCtx) {
          cropCtx.clearRect(0, 0, encWidth, encHeight);
          cropCtx.drawImage(canvas, 0, cropY, encWidth, encHeight, 0, 0, encWidth, encHeight);
          return cropCanvas;
        }
        return canvas;
      };

      setStatus(`PNG無損失フレーム生成中... (${totalUniqueFrames}枚, ${encWidth}x${encHeight})`);
      setProgress(4);

      const sessionRes = await fetch("/api/export/session", { method: "POST" });
      if (!sessionRes.ok) throw new Error("セッション作成に失敗しました");
      const sessionId = (await sessionRes.json()).sessionId;

      const canvasToBlob = (cvs: HTMLCanvasElement): Promise<Blob> =>
        new Promise((resolve, reject) => {
          cvs.toBlob((b) => { if (b) resolve(b); else reject(new Error("toBlob failed")); }, "image/png");
        });

      // Match the bulk-upload settings above — 30 frames × 5 parallel POSTs
      // keeps Railway's multer handler saturated without dropping requests.
      const batchSize = 30;
      const PARALLEL = 5;
      const allBatches: { blobs: Blob[]; names: string[] }[] = [];
      let currentBlobs: Blob[] = [];
      let currentNames: string[] = [];

      for (let i = 0; i < segs.length; i++) {
        if (cancelRef.current) break;
        drawFrame(ctx, segs[i].time + epsilon, sortedLyrics);
        const frameSource = getCroppedSource();
        const pngBlob = await canvasToBlob(frameSource);
        currentBlobs.push(pngBlob);
        currentNames.push(`frame_${String(i).padStart(6, "0")}.png`);

        if (currentBlobs.length >= batchSize || i === segs.length - 1) {
          allBatches.push({ blobs: [...currentBlobs], names: [...currentNames] });
          currentBlobs = [];
          currentNames = [];
        }

        if (i % 10 === 0) {
          const pct = 4 + ((i + 1) / totalUniqueFrames) * 30;
          setProgress(pct);
          setStatus(`クロップフレーム生成中... ${i + 1}/${totalUniqueFrames} (${encWidth}x${encHeight})`);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (cancelRef.current) { setExporting(false); setProgress(0); setStatus(""); return; }

      setStatus(`フレームアップロード中... (${allBatches.length}バッチ, ${PARALLEL}並列)`);
      setProgress(35);

      let uploadedBatches = 0;
      const uploadBatch = async (batch: { blobs: Blob[]; names: string[] }) => {
        const formData = new FormData();
        batch.blobs.forEach((b, idx) => formData.append("frames", b, batch.names[idx]));
        const upRes = await fetch(`/api/export/${sessionId}/frames`, { method: "POST", body: formData });
        if (!upRes.ok) {
          const errText = await upRes.text().catch(() => "");
          throw new Error(`フレームアップロード失敗 (${upRes.status}): ${errText}`);
        }
        uploadedBatches++;
        const pct = 35 + (uploadedBatches / allBatches.length) * 19;
        setProgress(pct);
        setStatus(`フレームアップロード中... ${uploadedBatches}/${allBatches.length}バッチ`);
      };

      for (let i = 0; i < allBatches.length; i += PARALLEL) {
        if (cancelRef.current) break;
        const chunk = allBatches.slice(i, i + PARALLEL);
        await Promise.all(chunk.map(b => uploadBatch(b)));
      }
      if (cancelRef.current) { setExporting(false); setProgress(0); setStatus(""); return; }

      let audioBlob: Blob | null = null;
      let audioFName = "audio.mp3";
      if (audioUrl) {
        if (activeAudioTrackId) { const t = await storage.getAudioTrack(activeAudioTrackId); if (t) { audioBlob = new Blob([t.arrayBuffer], { type: t.mimeType || "audio/mpeg" }); audioFName = t.fileName; } }
        if (!audioBlob) { const d = await storage.getAudio(projectId); if (d) { audioBlob = new Blob([d.arrayBuffer], { type: d.mimeType || "audio/mpeg" }); audioFName = d.fileName; } }
      }
      if (audioBlob) {
        const af = new FormData();
        af.append("audio", audioBlob, audioFName);
        await fetch(`/api/export/${sessionId}/audio`, { method: "POST", body: af });
      }

      setStatus("サーバーでProRes 4444 エンコード開始...");
      setProgress(56);
      const encodeRes = await fetch(`/api/export/${sessionId}/encode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fps: fpsNum, videoBitrate, audioBitrate, segments: segs.map((s, i) => ({ frame: i, duration: s.duration })),
          codec: "prores", async: true,
          cropY: cropActive ? cropY : -1,
          fullHeight: cropActive ? outputHeight : 0,
        }),
      });
      if (!encodeRes.ok) throw new Error("エンコード開始に失敗しました");

      setStatus(cropActive ? `サーバーでProRes 4444 変換中 (${encWidth}x${encHeight}, Y=${cropY})...` : "サーバーでProRes 4444 変換中...");
      setProgress(65);

      let encodeComplete = false;
      let pollCount = 0;
      let pollErrors = 0;
      while (!encodeComplete && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 2000));
        pollCount++;
        try {
          const statusRes = await fetch(`/api/export/${sessionId}/status`, { cache: "no-store" });
          if (statusRes.status === 304) { continue; }
          if (!statusRes.ok) {
            pollErrors++;
            if (pollErrors >= 3) throw new Error("変換状態の確認に失敗しました");
            continue;
          }
          pollErrors = 0;
          const statusData = await statusRes.json();
          if (statusData.status === "done") {
            encodeComplete = true;
          } else if (statusData.status === "error") {
            throw new Error(statusData.error || "ProRes変換に失敗しました");
          } else {
            setProgress(65 + Math.min(pollCount * 2, 18));
            setStatus(`サーバーでProRes 4444 変換中... ${pollCount * 2}秒経過`);
          }
        } catch (e: any) {
          if (e.message === "変換状態の確認に失敗しました" || e.message?.includes("ProRes変換に失敗")) throw e;
          pollErrors++;
          if (pollErrors >= 3) throw new Error("変換状態の確認に失敗しました");
        }
      }
      if (cancelRef.current) { setExporting(false); setProgress(0); setStatus(""); return; }

      const safeName = (projectName || "telop").replace(/[^\w\u3000-\u9fff\uff00-\uffef]/g, "_");
      const yTag = cropActive ? `_Y${cropY}_H${encHeight}` : "";
      const movFileName = `【TELOP】${safeName}_prores4444${yTag}.mov`;
      const presetVal = project.preset || "other";

      setStatus("Dropboxにアップロード中...");
      setProgress(85);

      let dropboxSuccess = false;
      let dropboxPath = "";
      try {
        const dbxRes = await fetch(`/api/export/${sessionId}/upload-to-dropbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset: presetVal, fileName: movFileName }),
        });
        if (dbxRes.ok) {
          const dbxData = await dbxRes.json();
          dropboxPath = dbxData.dropboxPath || "";
          dropboxSuccess = true;

          if (dbxData.downloadUrl) {
            setStatus("Dropboxからダウンロード中...");
            setProgress(90);
            try {
              const dlRes = await fetch(dbxData.downloadUrl);
              if (dlRes.ok) {
                const outputBlob = await dlRes.blob();
                const url = URL.createObjectURL(outputBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = movFileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }
            } catch (dlErr) {
              console.warn("Dropbox download failed, file saved to Dropbox:", dlErr);
            }
          }
        }
      } catch (dbxErr) {
        console.warn("Dropbox upload failed, trying direct download:", dbxErr);
      }

      if (!dropboxSuccess) {
        setStatus("直接ダウンロード中...");
        setProgress(87);
        const dlRes = await fetch(`/api/export/${sessionId}/download`);
        if (!dlRes.ok) {
          const errText = await dlRes.text().catch(() => "");
          throw new Error(`ダウンロードに失敗しました (${dlRes.status}): ${errText}`);
        }
        const outputBlob = await dlRes.blob();
        const url = URL.createObjectURL(outputBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = movFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setProgress(100);
      const cropInfo = cropActive ? ` [クロップ: ${encWidth}x${encHeight}, Arena配置: Y=${cropY}]` : "";
      const dbxInfo = dropboxSuccess ? ` → Dropbox: ${dropboxPath}` : "";
      setStatus(`完了${cropInfo}${dbxInfo}`);
      setExporting(false);
      setExportDone(true);
      return;
    } catch (err: any) {
      console.error("ProRes export error:", err);
      setErrorMsg(`書き出しエラー: ${err.message || err}`);
    }

    setExporting(false);
    setProgress(0);
    setStatus("");
  }, [timedLyrics, fps, videoBitrate, audioBitrate, audioUrl, project, presetConfig, activeAudioTrackId]);

  const generateConcatTxt = (segments: { frame: number; duration: number }[]): string => {
    const lines: string[] = [];
    for (const seg of segments) {
      const name = `frame_${String(seg.frame).padStart(6, "0")}.png`;
      lines.push(`file '${name}'`);
      lines.push(`duration ${seg.duration.toFixed(6)}`);
    }
    const lastSeg = segments[segments.length - 1];
    lines.push(`file 'frame_${String(lastSeg.frame).padStart(6, "0")}.png'`);
    return lines.join("\n");
  };

  const generateBatScript = (fpsNum: number, hasAudio: boolean, aFileName: string | null): string => {
    const outName = "output_vp9_alpha.webm";
    let cmd = `@echo off\nchcp 65001 >nul\necho.\necho ========================================\necho   Telop VP9 Alpha WebM 変換ツール\necho ========================================\necho.\n\nwhere ffmpeg >nul 2>nul\nif errorlevel 1 (\n  echo [エラー] FFmpegが見つかりません。\n  echo.\n  echo インストール方法:\n  echo   winget install ffmpeg\n  echo   または https://ffmpeg.org/download.html\n  echo.\n  pause\n  exit /b 1\n)\n\necho FFmpegでVP9+Alpha WebMを生成中...\necho.\n\n`;

    cmd += `ffmpeg -y -f concat -safe 0 -i concat.txt`;
    if (hasAudio && aFileName) {
      cmd += ` -i "${aFileName}"`;
    }
    cmd += ` -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v ${videoBitrate} -r ${fpsNum} -deadline good -cpu-used 4 -row-mt 1`;
    if (hasAudio) {
      cmd += ` -c:a libopus -b:a ${audioBitrate} -shortest`;
    }
    cmd += ` "${outName}"\n\n`;

    cmd += `if errorlevel 1 (\n  echo.\n  echo [エラー] 変換に失敗しました。\n  pause\n  exit /b 1\n)\n\necho.\necho 完了！ ${outName} が生成されました。\necho.\necho ■ ProRes 4444 への変換 (Resolume Arena用):\necho   ffmpeg -i ${outName} -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a pcm_s16le output_prores4444.mov\necho.\npause\n`;
    return cmd;
  };

  const generateShScript = (fpsNum: number, hasAudio: boolean, aFileName: string | null): string => {
    const outName = "output_vp9_alpha.webm";
    let cmd = `#!/bin/bash\nset -e\n\necho ""\necho "========================================"\necho "  Telop VP9 Alpha WebM 変換ツール"\necho "========================================"\necho ""\n\nif ! command -v ffmpeg &> /dev/null; then\n  echo "[エラー] FFmpegが見つかりません。"\n  echo ""\n  echo "インストール方法:"\n  echo "  macOS:  brew install ffmpeg"\n  echo "  Linux:  sudo apt install ffmpeg"\n  echo ""\n  exit 1\nfi\n\necho "FFmpegでVP9+Alpha WebMを生成中..."\necho ""\n\n`;

    cmd += `ffmpeg -y -f concat -safe 0 -i concat.txt`;
    if (hasAudio && aFileName) {
      cmd += ` -i "${aFileName}"`;
    }
    cmd += ` -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v ${videoBitrate} -r ${fpsNum} -deadline good -cpu-used 4 -row-mt 1`;
    if (hasAudio) {
      cmd += ` -c:a libopus -b:a ${audioBitrate} -shortest`;
    }
    cmd += ` "${outName}"\n\n`;

    cmd += `echo ""\necho "完了！ ${outName} が生成されました。"\necho ""\necho "■ ProRes 4444 への変換 (Resolume Arena用):"\necho "  ffmpeg -i ${outName} -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a pcm_s16le output_prores4444.mov"\necho ""\n`;
    return cmd;
  };

  const generateReadme = (fpsNum: number, hasAudio: boolean): string => {
    return `Telop VP9 Alpha フレームパック
================================

このZIPには、VP9+Alpha (yuva420p) WebM動画を生成するために
必要なファイルが含まれています。

■ 必要なもの
  - FFmpeg (https://ffmpeg.org/download.html)
    macOS:   brew install ffmpeg
    Windows: winget install ffmpeg
    Linux:   sudo apt install ffmpeg

■ 使い方
  1. このZIPを展開します${hasAudio ? "\n  2. 音声ファイルを同じフォルダに配置します" : ""}
  ${hasAudio ? "3" : "2"}. スクリプトを実行します:
     - Windows: convert.bat をダブルクリック
     - Mac/Linux: ターミナルで sh convert.sh を実行
  ${hasAudio ? "4" : "3"}. output_vp9_alpha.webm が生成されます

■ 内容
  - frames/ フォルダ: 透過PNGフレーム画像
  - concat.txt: FFmpeg用のフレーム結合リスト
  - convert.bat: Windows用変換スクリプト
  - convert.sh: Mac/Linux用変換スクリプト

■ 設定
  - 解像度: ${outputWidth}x${outputHeight}
  - フレームレート: ${fpsNum} fps
  - コーデック: VP9 (libvpx-vp9)
  - ピクセル形式: yuva420p (アルファチャンネル付き)

■ ProRes 4444 への変換 (Resolume Arena 7+ 対応)
  ffmpeg -i output_vp9_alpha.webm -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a pcm_s16le -movflags +faststart output_prores4444.mov

■ DXV への変換 (最高パフォーマンス)
  1. ProRes 4444 に変換後、Resolume Alley を開く
  2. .mov ファイルをドラッグ&ドロップ
  3. DXV3 + Alpha で書き出し

■ 対応ソフトウェア
  - VP9 WebM: After Effects, DaVinci Resolve, OBS Studio, VDMX, Premiere Pro
  - ProRes 4444: Resolume Arena 7+, DaVinci Resolve, Premiere Pro, After Effects, Final Cut Pro
`;
  };

  const handleZipExport = useCallback(async () => {
    if (timedLyrics.length === 0) return;
    cancelRef.current = false;
    setExporting(true);
    setExportDone(false);
    setProgress(0);
    setErrorMsg("");

    try {
      const fpsNum = parseInt(fps);
      const { blobs, segments } = await generateFrames(fpsNum);

      if (cancelRef.current) {
        setExporting(false);
        setProgress(0);
        setStatus("");
        return;
      }

      setStatus("ZIPを作成中...");
      setProgress(65);

      const zip = new JSZip();
      const framesFolder = zip.folder("frames")!;

      for (let i = 0; i < blobs.length; i++) {
        framesFolder.file(`frame_${String(i).padStart(6, "0")}.png`, blobs[i]);
      }

      const concatContent = generateConcatTxt(segments);
      const concatForRoot = concatContent.replace(/file 'frame_/g, "file 'frames/frame_");
      zip.file("concat.txt", concatForRoot);

      const hasAudio = !!audioUrl && !!audioFileName;
      zip.file("convert.bat", generateBatScript(fpsNum, hasAudio, audioFileName || null));
      zip.file("convert.sh", generateShScript(fpsNum, hasAudio, audioFileName || null));
      zip.file("README.txt", generateReadme(fpsNum, hasAudio));

      setStatus("ZIPを圧縮中...");
      setProgress(80);

      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } },
        (metadata) => {
          const pct = 80 + (metadata.percent / 100) * 20;
          setProgress(pct);
        }
      );

      const safeName = (projectName || "telop").replace(/[^\w\u3000-\u9fff\uff00-\uffef]/g, "_");
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `【TELOP】${safeName}_frames_${fpsNum}fps.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(100);
      setStatus("完了");
      setExporting(false);
      setExportDone(true);
      return;
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorMsg(`書き出しエラー: ${err.message || err}`);
    }

    setExporting(false);
    setProgress(0);
    setStatus("");
  }, [timedLyrics, fps, videoBitrate, audioBitrate, audioUrl, audioFileName, project, presetConfig, onOpenChange]);

  const handleExport = () => {
    if (exportMode === "server") {
      handleServerExport();
    } else if (exportMode === "prores") {
      handleProResExport();
    } else {
      handleZipExport();
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  const handleClose = () => {
    setExportDone(false);
    setProgress(0);
    setStatus("");
    onOpenChange(false);
  };

  const copyToClipboard = async (text: string, id?: string) => {
    await navigator.clipboard.writeText(text);
    if (id) {
      setCopiedInstall(id);
      setTimeout(() => setCopiedInstall(null), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const proresCmd = "ffmpeg -i telop_vp9_alpha.webm -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a pcm_s16le -movflags +faststart output_prores4444.mov";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!exporting) { if (!v) handleClose(); else onOpenChange(v); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-export-title">動画書き出し</DialogTitle>
          <DialogDescription>
            VP9 + Alpha (yuva420p) WebM を生成
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {exportDone ? (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2" data-testid="text-export-complete">
                  <CircleCheck className="w-4 h-4 text-green-500" />
                  ダウンロード完了
                </p>
                <p className="text-xs text-muted-foreground">
                  VP9 Alpha WebM ファイルがダウンロードされました。
                </p>
              </div>

              <div className="border rounded-md p-3 space-y-3" data-testid="section-prores-conversion">
                <p className="text-sm font-medium">ProRes 4444 への変換 (Resolume Arena用)</p>

                <div className="bg-muted/30 rounded-md p-2.5 space-y-1.5" data-testid="section-shutter-encoder">
                  <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Shutter Encoder (推奨 / GPU高速変換)
                  </p>
                  <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-0.5">
                    <li>
                      <a
                        href="https://www.shutterencoder.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                        data-testid="link-shutter-encoder"
                        
                      >
                        shutterencoder.com
                      </a>
                      {" "}からダウンロード (無料)
                    </li>
                    <li>Shutter Encoder を起動し、WebMファイルをドラッグ&ドロップ</li>
                    <li>出力形式: <span className="font-mono bg-black/20 px-1 rounded text-foreground">Apple ProRes</span> → プロファイル: <span className="font-mono bg-black/20 px-1 rounded text-foreground">4444</span></li>
                    <li>「開始」をクリック → GPU加速で高速変換</li>
                  </ol>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">FFmpeg (コマンドライン):</p>
                  <div className="bg-black/30 rounded p-2.5 font-mono text-[11px] break-all relative pr-8" data-testid="code-prores-cmd">
                    {proresCmd}
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 p-1 rounded hover-elevate"
                      onClick={() => {
                        copyToClipboard(proresCmd);
                        setCopiedProRes(true);
                        setTimeout(() => setCopiedProRes(false), 2000);
                      }}
                      data-testid="button-copy-prores-cmd"
                    >
                      {copiedProRes ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">DXV への変換 (最高パフォーマンス):</p>
                  <p>ProRes 4444 に変換後 → Resolume Alley で DXV3 + Alpha に書き出し</p>
                </div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <CircleCheck className="w-3.5 h-3.5 text-green-500" />
                  対応ソフトウェア
                </p>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground mr-1">WebM:</span>
                    <Badge variant="secondary">After Effects</Badge>
                    <Badge variant="secondary">DaVinci Resolve</Badge>
                    <Badge variant="secondary">OBS Studio</Badge>
                    <Badge variant="secondary">Premiere Pro</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground mr-1">ProRes:</span>
                    <Badge variant="secondary">Resolume Arena 7+</Badge>
                    <Badge variant="secondary">DaVinci Resolve</Badge>
                    <Badge variant="secondary">Premiere Pro</Badge>
                    <Badge variant="secondary">Final Cut Pro</Badge>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleClose} className="flex-1" data-testid="button-close-export">
                  閉じる
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm text-muted-foreground block mb-1.5">書き出し方法</label>
                <Select value={exportMode} onValueChange={(v) => setExportMode(v as ExportMode)} disabled={exporting}>
                  <SelectTrigger className="w-full" data-testid="select-export-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="server">WebM VP9 Alpha (推奨・最速)</SelectItem>
                    <SelectItem value="prores">ProRes 4444 MOV (Arena用・アルファ確実)</SelectItem>
                    <SelectItem value="zip">フレームパック ZIP (オフライン変換用)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {exportMode === "server" && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-3 space-y-2 text-sm">
                  <p className="font-medium flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-blue-400" />
                    サーバーエンコード (最速)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ネイティブFFmpegでマルチスレッド高速エンコード。
                    VFR最適化でフレーム数を最小限に抑え、サーバーに送信して処理します。
                  </p>
                </div>
              )}

              {exportMode === "prores" && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 space-y-2 text-sm">
                  <p className="font-medium flex items-center gap-1.5">
                    <Film className="w-4 h-4 text-green-400" />
                    ProRes 4444 MOV (Arena用)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    テキスト描画エリアを自動検出 → クロップ → ProRes 4444 (yuva444p10le) で高速エンコード。
                    FFmpeg 7.0 互換コンテナで Apple Silicon でも確実にアルファ透過。
                    Y座標はファイル名に埋め込み、Arenaで手動配置。
                  </p>
                </div>
              )}

              {exportMode === "zip" && (
                <div className="bg-muted/30 rounded-md p-3 space-y-2 text-sm">
                  <p className="font-medium">オフライン変換用</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
                    <li>ZIPをダウンロードして展開</li>
                    {audioUrl && audioFileName && (
                      <li>
                        音声ファイル{" "}
                        <span className="font-mono bg-black/20 px-1 rounded text-foreground">{audioFileName}</span>{" "}
                        を同じフォルダに配置
                      </li>
                    )}
                    <li>
                      <span className="font-mono bg-black/20 px-1 rounded">convert.bat</span> (Win) または{" "}
                      <span className="font-mono bg-black/20 px-1 rounded">convert.sh</span> (Mac) を実行
                    </li>
                    <li>VP9+Alpha WebM が生成されます</li>
                  </ol>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="text-sm text-muted-foreground block mb-1.5">出力サイズ</label>
                  <Badge variant="secondary">
                    {outputWidth} x {outputHeight}px
                  </Badge>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1.5">フレームレート</label>
                  <Select value={fps} onValueChange={setFps} disabled={exporting}>
                    <SelectTrigger className="w-[100px]" data-testid="select-fps">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24 fps</SelectItem>
                      <SelectItem value="30">30 fps</SelectItem>
                      <SelectItem value="60">60 fps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1.5">映像品質</label>
                  <Select value={videoBitrate} onValueChange={setVideoBitrate} disabled={exporting}>
                    <SelectTrigger className="w-[120px]" data-testid="select-video-bitrate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="400K">軽量 400K</SelectItem>
                      <SelectItem value="800K">標準 800K</SelectItem>
                      <SelectItem value="1500K">高画質 1.5M</SelectItem>
                      <SelectItem value="2M">最高 2M</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1.5">音声品質</label>
                  <Select value={audioBitrate} onValueChange={setAudioBitrate} disabled={exporting}>
                    <SelectTrigger className="w-[110px]" data-testid="select-audio-bitrate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="32k">軽量 32k</SelectItem>
                      <SelectItem value="64k">標準 64k</SelectItem>
                      <SelectItem value="128k">高音質 128k</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  タイミング済: {timedLyrics.length} / {lyrics.length} 行
                </span>
              </div>

              <div className="border-t pt-3 space-y-2.5">
                <button
                  type="button"
                  className="text-xs text-muted-foreground flex items-center gap-1 hover-elevate rounded-md px-1 py-0.5"
                  onClick={() => setShowExtra(!showExtra)}
                  data-testid="button-toggle-extra"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${showExtra ? "rotate-180" : ""}`} />
                  Shutter Encoder / FFmpegでProRes変換
                </button>

                {showExtra && (
                  <div className="space-y-2 text-xs text-muted-foreground bg-muted/30 rounded-md p-2.5">
                    <p className="font-medium text-foreground">Shutter Encoder (推奨 / GUI / GPU高速変換):</p>
                    <p>
                      <a
                        href="https://www.shutterencoder.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                      >
                        shutterencoder.com
                      </a>
                      {" "}(無料) でWebMをProRes 4444に高速変換。ドラッグ&ドロップで簡単操作。
                    </p>

                    <p className="font-medium text-foreground mt-2">FFmpeg (コマンドライン):</p>
                    <div className="bg-black/30 rounded p-2 font-mono text-[11px] break-all relative pr-8">
                      {proresCmd}
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-1 rounded hover-elevate"
                        onClick={() => copyToClipboard(proresCmd)}
                        data-testid="button-copy-prores-extra"
                      >
                        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>

                    <p className="font-medium text-foreground mt-2">FFmpegのインストール:</p>
                    <div className="space-y-1">
                      {[
                        { os: "macOS", cmd: "brew install ffmpeg", id: "mac" },
                        { os: "Windows", cmd: "winget install ffmpeg", id: "win" },
                        { os: "Linux", cmd: "sudo apt install ffmpeg", id: "linux" },
                      ].map(({ os, cmd, id }) => (
                        <div key={id} className="flex items-center gap-2">
                          <span className="w-16 text-muted-foreground">{os}:</span>
                          <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-[11px] flex-1">{cmd}</code>
                          <button
                            type="button"
                            className="p-0.5 rounded hover-elevate"
                            onClick={() => copyToClipboard(cmd, id)}
                            data-testid={`button-copy-install-${id}`}
                          >
                            {copiedInstall === id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      ))}
                    </div>

                    <p className="font-medium text-foreground mt-2">DXV への変換 (最高パフォーマンス):</p>
                    <p>ProRes 4444 に変換後 → Resolume Alley で DXV3 + Alpha に書き出し</p>
                  </div>
                )}
              </div>

              {exporting && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>{status}</span>
                  </div>
                  <Progress value={progress} className="h-2" data-testid="progress-export" />
                </div>
              )}

              {errorMsg && (
                <div className="text-sm text-red-500" data-testid="text-export-error">
                  {errorMsg}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2">
                {!exporting ? (
                  <>
                    {exportMode === "server" ? (
                      <>
                        <Button
                          onClick={() => handleExport()}
                          disabled={timedLyrics.length === 0}
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                          data-testid="button-start-export"
                        >
                          <Film className="w-4 h-4 mr-2" />
                          WebM (VP9+Alpha) 書き出し
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => handleExport()}
                        disabled={exportMode !== "zip" && timedLyrics.length === 0}
                        className="flex-1"
                        data-testid="button-start-export"
                      >
                        {exportMode === "zip" ? (
                          <>
                            <FolderArchive className="w-4 h-4 mr-2" />
                            フレームパック (ZIP) ダウンロード
                          </>
                        ) : (
                          <>
                            <Film className="w-4 h-4 mr-2" />
                            ProRes 4444 MOV をダウンロード
                          </>
                        )}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    onClick={handleCancel}
                    variant="destructive"
                    className="flex-1"
                    data-testid="button-cancel-export"
                  >
                    キャンセル
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
