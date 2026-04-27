// 譜割（SCORE）タブ：完全自動生成・読み取り専用のビュー。
//
// 仕様（のむさん最終合意）：
//   - タイムラインの SECTION ブロック（リハーサルマーク）と TELOP（歌詞）が source of truth
//   - 譜割タブはそれを「時間順 / SECTION 順」に並べて表示するだけ
//   - 編集機能はなし（textarea や prompt は使わない）
//   - SECTION を動かせば即時に譜割タブも再構築される
//
// 列構成：TIME | SECTION | BAR | LYRIC
//   - TIME：SECTION 開始時刻（m:ss）
//   - SECTION：ラベル（INTRO, A, サビ など）
//   - BAR：その SECTION の小節数を tokenizeBars で自動分解（4, 4, 2, 1, 2/4 など）
//   - LYRIC：SECTION の時間範囲（startTime 〜 endTime）に入った歌詞を順番に表示
//
// 行高は SECTION ごとに「BAR トークン数」と「LYRIC 行数」の大きい方で決まる。
// SECTION 同士の間には 1 行分の区切り（横線）を挿入する。

import { useMemo } from "react";
import type { LyricLine } from "@shared/schema";
import { TS_DESIGN } from "@/lib/designTokens";

export type SectionBlockForScore = { id: string; label: string; startBar: number; endBar: number };

type Props = {
  sectionBlocks: SectionBlockForScore[];
  bpm: number | null | undefined;
  bpmGridOffset: number;
  lyrics: LyricLine[];
};

const LINE_H = 24;
const FONT_SIZE = 13;

/** 小節数をビート単位に分解して読みやすくする。例：6 → ["4", "2"]、5.5 → ["4", "1", "2/4"] */
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

/** 秒数を「m:ss」形式の文字列に整形（負値は 0:00 にクランプ）。 */
function formatTimeMSS(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type SectionView = {
  id: string;
  label: string;
  barTokens: string[];
  lyricLines: string[];
  /** SECTION の開始 grid 行（1-based）*/
  rowStart: number;
  /** SECTION の中身の行数 = max(BAR トークン数, LYRIC 行数, 1) */
  contentLines: number;
  /** SECTION 開始時刻（秒） */
  startTimeSec: number;
};

export function ScorePanel({ sectionBlocks, bpm, bpmGridOffset, lyrics }: Props) {
  // タイムライン位置順（startBar 昇順）に必ず並べる。
  const sortedSectionBlocks = useMemo(
    () => [...sectionBlocks].sort((a, b) => a.startBar - b.startBar),
    [sectionBlocks],
  );

  const { sections, totalRows } = useMemo(() => {
    const sec: SectionView[] = [];
    let cursor = 1;
    const secPerBar = bpm && bpm > 0 ? (60 / bpm) * 4 : 0;
    for (const block of sortedSectionBlocks) {
      const totalBars = block.endBar - block.startBar;
      const barTokens = tokenizeBars(totalBars);
      const startTime = secPerBar > 0 ? bpmGridOffset + block.startBar * secPerBar : 0;
      const endTime = secPerBar > 0 ? bpmGridOffset + block.endBar * secPerBar : 0;
      const lyricLines = lyrics
        .filter((l) => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
        .map((l) => l.text);
      const contentLines = Math.max(1, barTokens.length, lyricLines.length);
      sec.push({
        id: block.id,
        label: block.label,
        barTokens,
        lyricLines,
        rowStart: cursor,
        contentLines,
        startTimeSec: startTime,
      });
      cursor += contentLines + 1; // +1 = SECTION 間の区切り行
    }
    return { sections: sec, totalRows: cursor - 1 };
  }, [sortedSectionBlocks, bpm, bpmGridOffset, lyrics]);

  if (!bpm || bpm <= 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          BPM を検出するとここに譜割が表示されます。
        </div>
      </div>
    );
  }

  if (sectionBlocks.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          タイムラインに SECTION ブロックを配置すると、ここに譜割が自動で並びます。
        </div>
      </div>
    );
  }

  const totalHeight = totalRows * LINE_H;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
      <Header />
      <div className="flex-1 overflow-y-auto" data-testid="score-scroll">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "56px 64px 64px 1fr",
            gridAutoRows: `${LINE_H}px`,
            position: "relative",
            fontFamily: "inherit",
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_H}px`,
            minHeight: totalHeight,
          }}
        >
          {sections.flatMap((s) => {
            const cells: React.ReactNode[] = [];

            // TIME 列：SECTION 開始時刻、上合わせ、span = contentLines
            cells.push(
              <div
                key={`${s.id}-time`}
                style={{
                  gridColumn: 1,
                  gridRow: `${s.rowStart} / span ${s.contentLines}`,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  color: TS_DESIGN.text3,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.04em",
                }}
                data-testid={`score-time-${s.id}`}
              >
                <span style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{formatTimeMSS(s.startTimeSec)}</span>
              </div>,
            );

            // SECTION 列：ラベル、上合わせ、span = contentLines
            cells.push(
              <div
                key={`${s.id}-sec`}
                style={{
                  gridColumn: 2,
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

            // BAR 列：トークンを 1 行ずつ縦に並べる（自動計算のみ、編集不可）
            for (let i = 0; i < s.contentLines; i++) {
              const tok = s.barTokens[i] ?? "";
              cells.push(
                <div
                  key={`${s.id}-bar-${i}`}
                  style={{
                    gridColumn: 3,
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

            // LYRIC 列：時間範囲内の歌詞を 1 行ずつ表示（編集不可）
            for (let i = 0; i < s.contentLines; i++) {
              const text = s.lyricLines[i] ?? "";
              cells.push(
                <div
                  key={`${s.id}-lyric-${i}`}
                  style={{
                    gridColumn: 4,
                    gridRow: s.rowStart + i,
                    padding: "0 10px",
                    color: TS_DESIGN.text,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {text}
                </div>,
              );
            }

            // 区切り行：4 列分の縦線維持 + 横線中央
            const dividerRow = s.rowStart + s.contentLines;
            const dividerBg = `linear-gradient(to bottom, transparent 0, transparent ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2}px, transparent ${LINE_H / 2}px, transparent ${LINE_H}px)`;
            cells.push(
              <div
                key={`${s.id}-divtime`}
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
                key={`${s.id}-divsec`}
                style={{
                  gridColumn: 2,
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
                  gridColumn: 3,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            cells.push(
              <div
                key={`${s.id}-divlyric`}
                style={{
                  gridColumn: 4,
                  gridRow: dividerRow,
                  backgroundImage: dividerBg,
                }}
              />,
            );

            return cells;
          })}
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
        gridTemplateColumns: "56px 64px 64px 1fr",
        borderBottom: `1px solid ${TS_DESIGN.border}`,
      }}
    >
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>TIME</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>SECTION</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>BAR</div>
      <div style={{ padding: "6px 10px", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>LYRIC</div>
    </div>
  );
}
