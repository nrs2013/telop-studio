// 譜割（SCORE）タブのスプレッドシート UI（派生モード、左で高さ決定 / 右は 1 つの textarea）。
//
// 設計：
//   - 全列を同じフォント（13px）と同じ行高（24px）で揃える
//   - 左側（SECTION + BAR）：各 SECTION の高さは BAR トークン数 + 1（区切り行）で決まる
//     SECTION 列は先頭に名前（上合わせ）、残りは空セル
//     BAR 列は 1 トークン 1 行で縦積み
//     区切り行は 3 列に薄い横線
//   - 右側（LYRIC）：1 つの textarea で全曲分の歌詞を保持
//     高さ全体 = 左の合計行数 × 24px。一気にペーストして自由に流せる
//     横線は左の区切り行と同じ Y 位置に薄く描画。歌詞テキストは線を跨いで自由配置
//
// データ：
//   - 全曲分の歌詞は useScoreFullText（telop-score-fulltext-{id}）に 1 つの文字列として保存
//   - 既存の telop-score-v3（旧手入力データ）は読み取りのみ。書き戻しなし
//   - ユーザーが未編集（fullText === null）の場合はセクションごとの初期値を計算して
//     1 つの文字列に組み立てて表示

import { useMemo } from "react";
import type { ScoreRow } from "@/hooks/useScoreRows";
import type { LyricLine } from "@shared/schema";
import { TS_DESIGN } from "@/lib/designTokens";

export type SectionBlockForScore = { id: string; label: string; startBar: number; endBar: number };

type Props = {
  sectionBlocks: SectionBlockForScore[];
  scoreRows: ScoreRow[];
  bpm: number | null | undefined;
  bpmGridOffset: number;
  lyrics: LyricLine[];
  fullText: string | null;
  onFullTextChange: (value: string) => void;
};

const LINE_H = 24;
const FONT_SIZE = 13;

function tokenizeBars(totalBars: number): string[] {
  const rounded = Math.round(totalBars * 4) / 4;
  if (rounded <= 0) return [];
  const tokens: string[] = [];
  let r = rounded;
  while (r >= 4 - 0.001) { tokens.push("4"); r -= 4; }
  while (r >= 2 - 0.001) { tokens.push("2"); r -= 2; }
  while (r >= 1 - 0.001) { tokens.push("1"); r -= 1; }
  const beats = Math.round(r * 4);
  if (beats > 0) tokens.push(`${beats}/4`);
  return tokens;
}

function buildLegacyLyricMap(scoreRows: ScoreRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const sr of scoreRows) {
    const firstSection = sr.section.split("\n").map(s => s.trim()).find(s => s) || "";
    if (firstSection && !map[firstSection] && sr.lyric) {
      map[firstSection] = sr.lyric;
    }
  }
  return map;
}

type SectionView = {
  id: string;
  label: string;
  barsTokens: string[];
  /** SECTION の開始 grid 行（1-based）*/
  rowStart: number;
  /** content 行数 = barsTokens.length（最低 1）*/
  contentLines: number;
  /** SECTION 全体の行数 = contentLines + 1（区切り）*/
  totalLines: number;
};

export function ScorePanel({ sectionBlocks, scoreRows, bpm, bpmGridOffset, lyrics, fullText, onFullTextChange }: Props) {
  const { sections, totalRows } = useMemo(() => {
    const sec: SectionView[] = [];
    let cursor = 1;
    for (const block of sectionBlocks) {
      const totalBars = block.endBar - block.startBar;
      const tokens = tokenizeBars(totalBars);
      const contentLines = Math.max(1, tokens.length);
      sec.push({
        id: block.id,
        label: block.label,
        barsTokens: tokens,
        rowStart: cursor,
        contentLines,
        totalLines: contentLines + 1, // +1 = 区切り
      });
      cursor += contentLines + 1;
    }
    return { sections: sec, totalRows: cursor - 1 };
  }, [sectionBlocks]);

  // 初期値（fullText === null のときに使う）
  const initialFullText = useMemo(() => {
    if (!bpm || bpm <= 0 || sectionBlocks.length === 0) return "";
    const beatsPerBar = 4;
    const secPerBar = (60 / bpm) * beatsPerBar;
    const legacyLyricMap = buildLegacyLyricMap(scoreRows);
    const allLines: string[] = [];
    for (const block of sectionBlocks) {
      const startTime = bpmGridOffset + block.startBar * secPerBar;
      const endTime = bpmGridOffset + block.endBar * secPerBar;
      const matched = lyrics
        .filter(l => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
      const telopText = matched.map(l => l.text).join("\n");
      const baseText = telopText || legacyLyricMap[block.label] || "";
      const lines = baseText ? baseText.split("\n") : [];
      const targetContentLines = Math.max(1, tokenizeBars(block.endBar - block.startBar).length);
      while (lines.length < targetContentLines) lines.push("");
      allLines.push(...lines, ""); // content + 区切り行
    }
    return allLines.join("\n");
  }, [sectionBlocks, scoreRows, bpm, bpmGridOffset, lyrics]);

  const displayLyric = fullText !== null ? fullText : initialFullText;

  if (!bpm || bpm <= 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: TS_DESIGN.bg2 }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          BPM を検出するとここに譜割が表示されます。
        </div>
      </div>
    );
  }

  if (sectionBlocks.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: TS_DESIGN.bg2 }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          タイムラインに SECTION ブロックを配置すると、ここに譜割が自動で並びます。
        </div>
      </div>
    );
  }

  // 区切り行の Y 位置（content の終わり）
  const dividerYs = sections.map(s => (s.rowStart - 1 + s.contentLines) * LINE_H);
  const totalHeight = totalRows * LINE_H;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: TS_DESIGN.bg2 }}>
      <Header />
      <div className="flex-1 overflow-y-auto" data-testid="score-scroll">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "64px 64px 1fr",
            gridAutoRows: `${LINE_H}px`,
            position: "relative",
            fontFamily: "inherit",
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_H}px`,
            minHeight: totalHeight,
          }}
        >
          {/* 左：SECTION + BAR cells */}
          {sections.flatMap((s) => {
            const cells: React.ReactNode[] = [];
            // SECTION 列：先頭行に名前、span = contentLines
            cells.push(
              <div
                key={`${s.id}-sec`}
                style={{
                  gridColumn: 1,
                  gridRow: `${s.rowStart} / span ${s.contentLines}`,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  color: "hsl(0 0% 75%)",
                  fontWeight: 500,
                }}
                data-testid={`score-section-${s.id}`}
              >
                <span style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{s.label}</span>
              </div>,
            );
            // BAR 列：トークンを 1 行 1 個
            for (let i = 0; i < s.contentLines; i++) {
              const tok = s.barsTokens[i] || "";
              cells.push(
                <div
                  key={`${s.id}-bar-${i}`}
                  style={{
                    gridColumn: 2,
                    gridRow: s.rowStart + i,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRight: `1px solid ${TS_DESIGN.border}`,
                    color: TS_DESIGN.text3,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "0.04em",
                  }}
                >
                  {tok}
                </div>,
              );
            }
            // 区切り行：SECTION 列・BAR 列に縦線維持しつつ、横線を中央に
            const dividerRow = s.rowStart + s.contentLines;
            const dividerBg = `linear-gradient(to bottom, transparent 0, transparent ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2}px, transparent ${LINE_H / 2}px, transparent ${LINE_H}px)`;
            cells.push(
              <div
                key={`${s.id}-divsec`}
                style={{
                  gridColumn: 1,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            cells.push(
              <div
                key={`${s.id}-divbar`}
                style={{
                  gridColumn: 2,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            return cells;
          })}

          {/* 右側：LYRIC textarea + 横線オーバーレイ。grid-row 1 / -1 で全行を貫通 */}
          <div
            style={{
              gridColumn: 3,
              gridRow: `1 / span ${totalRows}`,
              position: "relative",
            }}
          >
            {/* 横線オーバーレイ（区切り行の Y 位置に薄く） */}
            {dividerYs.map((y, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y + LINE_H / 2 - 0.5,
                  height: 1,
                  background: TS_DESIGN.border,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              />
            ))}
            <textarea
              value={displayLyric}
              onChange={(e) => onFullTextChange(e.target.value)}
              spellCheck={false}
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                minHeight: totalHeight,
                height: totalHeight,
                padding: "0 10px",
                border: 0,
                outline: "none",
                background: "transparent",
                color: TS_DESIGN.text,
                resize: "none",
                fontFamily: "inherit",
                fontSize: FONT_SIZE,
                lineHeight: `${LINE_H}px`,
                overflow: "auto",
                display: "block",
              }}
              data-testid="score-lyric-fulltext"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div
      className="shrink-0"
      style={{
        display: "grid",
        gridTemplateColumns: "64px 64px 1fr",
        borderBottom: `1px solid ${TS_DESIGN.border}`,
      }}
    >
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>SECTION</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>BAR</div>
      <div style={{ padding: "6px 10px", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>LYRIC</div>
    </div>
  );
}
