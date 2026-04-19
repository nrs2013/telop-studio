export interface TextSegment {
  text: string;
  ruby?: string;
}

const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

export function parseRubyText(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /(?:(?:\[|\uff3b)([^\]\uff3d]*)(?:\]|\uff3d))?[{｛]([^}｝]*)[}｝]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    const bracketTarget = match[1];
    const rubyText = match[2];
    const fullMatchStart = match.index;

    if (!rubyText) {
      const before = input.slice(lastIndex, fullMatchStart);
      if (before) segments.push({ text: before });
      lastIndex = match.index + match[0].length;
      continue;
    }

    if (bracketTarget != null) {
      const before = input.slice(lastIndex, fullMatchStart);
      if (before) segments.push({ text: before });
      segments.push({ text: bracketTarget, ruby: rubyText });
      lastIndex = match.index + match[0].length;
      continue;
    }

    const before = input.slice(lastIndex, fullMatchStart);

    let scanEnd = before.length;
    while (scanEnd > 0 && /[\s\u3000]/.test(before[scanEnd - 1])) {
      scanEnd--;
    }

    let kanjiStart = scanEnd;
    while (kanjiStart > 0 && KANJI_REGEX.test(before[kanjiStart - 1])) {
      kanjiStart--;
    }

    if (kanjiStart === scanEnd) {
      segments.push({ text: before + match[0] });
      lastIndex = match.index + match[0].length;
      continue;
    }

    const prePart = before.slice(0, kanjiStart);
    const kanjiPart = before.slice(kanjiStart, scanEnd);

    if (prePart) {
      segments.push({ text: prePart });
    }
    segments.push({ text: kanjiPart, ruby: rubyText });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex) });
  }

  return segments;
}

export function getPlainText(input: string): string {
  return parseRubyText(input).map((s) => s.text).join("");
}

const BLUR_PASSES = 6;

function drawStrokeBlurred(
  ctx: CanvasRenderingContext2D,
  drawStrokeFn: (lw: number) => void,
  strokeWidth: number,
  blurAmount: number,
  alpha: number,
): void {
  ctx.save();
  for (let i = BLUR_PASSES; i >= 1; i--) {
    const ratio = i / BLUR_PASSES;
    const expand = ratio * blurAmount;
    ctx.globalAlpha = alpha * (1 - ratio) * (1 / BLUR_PASSES) * 2;
    drawStrokeFn(strokeWidth + expand);
  }
  ctx.globalAlpha = alpha;
  drawStrokeFn(strokeWidth);
  ctx.restore();
}

export function drawTextWithRuby(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string,
  textAlign: string,
  fontColor: string,
  strokeColor: string,
  strokeWidth: number,
  globalAlpha: number = 1,
  strokeBlur: number = 0,
): void {
  const segments = parseRubyText(text);
  const hasRuby = segments.some((s) => s.ruby);

  if (!hasRuby) {
    ctx.save();
    ctx.globalAlpha = globalAlpha;
    ctx.font = `bold ${fontSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
    ctx.textAlign = textAlign as CanvasTextAlign;
    ctx.textBaseline = "middle";

    if (strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      if (strokeBlur > 0) {
        drawStrokeBlurred(ctx, (lw) => {
          ctx.lineWidth = lw;
          ctx.strokeText(text, x, y);
        }, strokeWidth, strokeBlur, globalAlpha);
      } else {
        ctx.strokeText(text, x, y);
      }
    }
    ctx.globalAlpha = globalAlpha;
    ctx.fillStyle = fontColor;
    ctx.fillText(text, x, y);
    ctx.restore();
    return;
  }

  const mainFont = `bold ${fontSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
  const rubyFontSize = Math.round(fontSize * 0.2);
  const rubyFont = `bold ${rubyFontSize}px "${fontFamily}", "Noto Sans JP", sans-serif`;
  const rubyStrokeWidth = Math.max(1, Math.round(strokeWidth * 0.8));

  ctx.save();
  ctx.font = mainFont;
  let totalWidth = 0;
  for (const seg of segments) {
    totalWidth += ctx.measureText(seg.text).width;
  }

  let startX = x;
  if (textAlign === "center") {
    startX = x - totalWidth / 2;
  } else if (textAlign === "right") {
    startX = x - totalWidth;
  }

  ctx.globalAlpha = globalAlpha;
  const useBlur = strokeWidth > 0 && strokeBlur > 0;

  if (useBlur) {
    ctx.save();
    for (let i = BLUR_PASSES; i >= 1; i--) {
      const ratio = i / BLUR_PASSES;
      const expand = ratio * strokeBlur;
      ctx.globalAlpha = globalAlpha * (1 - ratio) * (1 / BLUR_PASSES) * 2;

      let cx = startX;
      for (const seg of segments) {
        ctx.font = mainFont;
        const segWidth = ctx.measureText(seg.text).width;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth + expand;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.strokeText(seg.text, cx, y);

        if (seg.ruby) {
          ctx.font = rubyFont;
          const rubyWidth = ctx.measureText(seg.ruby).width;
          const rubyY = y - fontSize / 2 - rubyFontSize * 0.65;
          const rubyExpand = ratio * strokeBlur * 0.6;
          ctx.lineWidth = rubyStrokeWidth + rubyExpand;

          if (seg.ruby.length > 1 && rubyWidth < segWidth) {
            const totalRubyCharWidth = seg.ruby.split("").reduce(
              (sum, ch) => sum + ctx.measureText(ch).width, 0,
            );
            const spacing = (segWidth - totalRubyCharWidth) / (seg.ruby.length + 1);
            let rx = cx + spacing;
            for (const ch of seg.ruby) {
              const chW = ctx.measureText(ch).width;
              ctx.strokeText(ch, rx, rubyY);
              rx += chW + spacing;
            }
          } else {
            const rubyX = cx + (segWidth - rubyWidth) / 2;
            ctx.strokeText(seg.ruby, rubyX, rubyY);
          }
          ctx.font = mainFont;
        }
        cx += segWidth;
      }
    }

    ctx.globalAlpha = globalAlpha;
    let cx2 = startX;
    for (const seg of segments) {
      ctx.font = mainFont;
      const segWidth = ctx.measureText(seg.text).width;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.strokeText(seg.text, cx2, y);

      if (seg.ruby) {
        ctx.font = rubyFont;
        const rubyWidth = ctx.measureText(seg.ruby).width;
        const rubyY = y - fontSize / 2 - rubyFontSize * 0.65;
        ctx.lineWidth = rubyStrokeWidth;

        if (seg.ruby.length > 1 && rubyWidth < segWidth) {
          const totalRubyCharWidth = seg.ruby.split("").reduce(
            (sum, ch) => sum + ctx.measureText(ch).width, 0,
          );
          const spacing = (segWidth - totalRubyCharWidth) / (seg.ruby.length + 1);
          let rx = cx2 + spacing;
          for (const ch of seg.ruby) {
            const chW = ctx.measureText(ch).width;
            ctx.strokeText(ch, rx, rubyY);
            rx += chW + spacing;
          }
        } else {
          const rubyX = cx2 + (segWidth - rubyWidth) / 2;
          ctx.strokeText(seg.ruby, rubyX, rubyY);
        }
        ctx.font = mainFont;
      }
      cx2 += segWidth;
    }
    ctx.restore();
  }

  const drawSharp = strokeWidth > 0 && !useBlur;
  ctx.globalAlpha = globalAlpha;

  let curX = startX;
  for (const seg of segments) {
    ctx.font = mainFont;
    const segWidth = ctx.measureText(seg.text).width;

    if (drawSharp) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.strokeText(seg.text, curX, y);
    }
    ctx.fillStyle = fontColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(seg.text, curX, y);

    if (seg.ruby) {
      ctx.font = rubyFont;
      const rubyWidth = ctx.measureText(seg.ruby).width;
      const rubyY = y - fontSize / 2 - rubyFontSize * 0.65;

      if (seg.ruby.length > 1 && rubyWidth < segWidth) {
        const totalRubyCharWidth = seg.ruby.split("").reduce(
          (sum, ch) => sum + ctx.measureText(ch).width, 0,
        );
        const spacing = (segWidth - totalRubyCharWidth) / (seg.ruby.length + 1);
        let rx = curX + spacing;
        for (const ch of seg.ruby) {
          const chW = ctx.measureText(ch).width;
          if (drawSharp) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = rubyStrokeWidth;
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.strokeText(ch, rx, rubyY);
          }
          ctx.fillStyle = fontColor;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, rx, rubyY);
          rx += chW + spacing;
        }
      } else {
        const rubyX = curX + (segWidth - rubyWidth) / 2;
        if (drawSharp) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = rubyStrokeWidth;
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.strokeText(seg.ruby, rubyX, rubyY);
        }
        ctx.fillStyle = fontColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(seg.ruby, rubyX, rubyY);
      }
      ctx.font = mainFont;
    }

    curX += segWidth;
  }

  ctx.restore();
}
